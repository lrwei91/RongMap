const api = require('./api');
const session = require('./session');

// 原 Web 端靠 Supabase Realtime 的 WebSocket 推送做多端同步。
// 小程序没有等价的长连接通道（云服务也不提供 Realtime），改用「页面 onShow + 下拉刷新」
// 触发全量重取。数据量在千级以内，一次 bootstrap 只有 5 个查询，代价可接受。
//
// store 是模块级单例：tabBar 三个页面共享同一份数据，避免切 tab 重复请求。
//
// 冷启动优化：bootstrap 成功后把可见数据快照写入本地缓存（rongmap:snapshot:v1），
// 下次冷启动先用快照渲染首帧、再静默换新；缓存只是体验优化，任何读写失败都静默降级。

const SNAPSHOT_KEY = 'rongmap:snapshot:v1';
// 活动记录只缓存最近 60 条：缓存用于首屏观感，不求完整，也控制单键体积（上限 1MB）。
const ACTIVITY_CACHE_LIMIT = 60;

const listeners = [];
let state = {
  status: 'idle', // idle | anonymous | loading | ready | error
  error: '',
  identity: null,
  currentUser: null,
  space: null,
  members: [],
  tags: [],
  locations: [],
  trash: [],
  activity: [],
  updatedAt: 0
};

// 请求序号：reset 或重入时自增，作废 in-flight 的 load，
// 防止登出后迟到的响应把上一账号的数据写回。
let loadSeq = 0;

function getState() {
  return state;
}

/** 订阅状态变更，返回取消订阅函数（用于页面 onUnload）。 */
function subscribe(listener) {
  listeners.push(listener);
  return function unsubscribe() {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
}

function emit() {
  listeners.slice().forEach(function (listener) {
    try {
      listener(state);
    } catch (error) {
      console.error('[RongMap] store listener failed', JSON.stringify({ stage: 'emit' }));
    }
  });
}

/** bootstrap 成功后回写快照；写失败（超单键 1MB / 总量超限）静默跳过。 */
function persistSnapshot(uid, data) {
  try {
    wx.setStorageSync(SNAPSHOT_KEY, {
      uid: uid,
      savedAt: Date.now(),
      payload: {
        space: data.space,
        currentUser: data.currentUser,
        members: data.members,
        tags: data.tags,
        locations: data.locations,
        // trash 不进缓存（回收站是低频页，冷启动首帧显示 0 条即可）；
        // activity 截断，控制体积。
        activity: (data.activity || []).slice(0, ACTIVITY_CACHE_LIMIT)
      }
    });
  } catch (error) {
    // 缓存失败不影响主流程。
  }
}

/** 读取快照；uid 不匹配或形状异常一律按无缓存处理。 */
function readSnapshot(uid) {
  try {
    const stored = wx.getStorageSync(SNAPSHOT_KEY);
    if (stored && stored.uid === uid && stored.payload && typeof stored.payload === 'object') {
      return stored;
    }
  } catch (error) {
    // 读损坏容器同样按无缓存处理。
  }
  return null;
}

/** 用快照拼一份 ready 状态：字段形状与 bootstrap 后一致，trash 为空。 */
function snapshotState(stored, identity) {
  const payload = stored.payload;
  return Object.assign({}, state, {
    status: 'ready',
    error: '',
    identity: identity,
    space: payload.space || null,
    currentUser: payload.currentUser || null,
    members: payload.members || [],
    tags: payload.tags || [],
    locations: payload.locations || [],
    trash: [],
    activity: payload.activity || [],
    updatedAt: stored.savedAt || Date.now()
  });
}

/**
 * 拉取（或复用）全量数据。
 * @param {boolean} force 强制重取，用于下拉刷新与写操作后的回填。
 */
async function load(force) {
  if (state.status === 'loading') return state;
  if (state.status === 'ready' && !force) return state;

  const seq = loadSeq + 1;
  loadSeq = seq;

  let identity = null;
  try {
    identity = await session.loadIdentity();
  } catch (error) {
    identity = null;
  }
  if (seq !== loadSeq) return state;

  if (!identity) {
    state = Object.assign({}, state, { status: 'anonymous', identity: null, error: '' });
    emit();
    return state;
  }

  // 非强制加载时先用本地快照点亮界面，随后照常发网络请求换新。
  let fromCache = false;
  if (!force) {
    const stored = readSnapshot(identity.uid);
    if (stored) {
      state = snapshotState(stored, identity);
      fromCache = true;
      emit();
    }
  }
  if (!fromCache) {
    state = Object.assign({}, state, { status: 'loading', error: '', identity: identity });
    emit();
  }

  try {
    const data = await api.bootstrap(identity);
    if (seq !== loadSeq) return state;
    state = Object.assign({}, state, {
      status: 'ready',
      error: '',
      identity: identity,
      currentUser: data.currentUser,
      space: data.space,
      members: data.members,
      tags: data.tags,
      locations: data.locations,
      trash: data.trash,
      activity: data.activity,
      updatedAt: Date.now()
    });
    persistSnapshot(identity.uid, data);
    emit();
  } catch (error) {
    if (seq !== loadSeq) return state;
    if (fromCache) {
      // 已有快照可看：把刷新失败降级为一条日志，页面继续展示缓存。
      console.warn('[RongMap] 数据刷新失败，继续展示本地快照');
      return state;
    }
    state = Object.assign({}, state, {
      status: 'error',
      error: (error && error.message) || '数据加载失败'
    });
    emit();
  }
  return state;
}

/** 写操作后调用：重取数据并通知所有页面。 */
function refresh() {
  return load(true);
}

/** 登出或换账号时清空，避免把上一个账号的数据渲染出来。 */
function reset() {
  loadSeq += 1;
  try {
    wx.removeStorageSync(SNAPSHOT_KEY);
  } catch (error) {
    // 清理失败不阻塞登出。
  }
  state = {
    status: 'idle',
    error: '',
    identity: null,
    currentUser: null,
    space: null,
    members: [],
    tags: [],
    locations: [],
    trash: [],
    activity: [],
    updatedAt: 0
  };
  emit();
}

/** 仅更新当前成员的显示名，避免整表重取。 */
function patchMemberName(name) {
  const members = state.members.map(function (item) {
    return item.id === state.currentUser.id ? Object.assign({}, item, { name: name }) : item;
  });
  state = Object.assign({}, state, {
    members: members,
    currentUser: Object.assign({}, state.currentUser, { name: name }),
    identity: Object.assign({}, state.identity, {
      member: Object.assign({}, state.identity.member, { name: name })
    })
  });
  emit();
}

module.exports = { getState, subscribe, load, refresh, reset, patchMemberName };
