const api = require('../../utils/api');
const store = require('../../utils/store');
const { matchesLocation, sortLocations, hasCoordinates, isLocationInBounds } = require('../../utils/location');
const { EMPTY_FILTERS, CATEGORIES } = require('../../utils/constants');
const { decorateLocation } = require('../../utils/format');
const discovery = require('../../utils/discovery');

const CATEGORY_TABS = [{ key: 'all', label: '全部' }].concat(
  Object.keys(CATEGORIES).map(function (key) {
    return { key: key, label: CATEGORIES[key].label };
  })
);

/**
 * 一条地点的内容签名：只要签名没变，重建数组、setData、diff、重渲染卡片这一整串都是白跑。
 * 平移地图时 regionchange 会连续触发，这层判断直接决定了拖动的顺滑度。
 * 用 JSON 序列化而不是拼分隔符，避免「内容里恰好含分隔符」造成签名误判。
 */
function contentSignature(item) {
  return JSON.stringify([
    item.id,
    item.name,
    item.address,
    item.category,
    item.reason,
    // version 必须进签名：卡片是编辑入口，列表项带着过期版本号进编辑态会白撞一次 409。
    item.version,
    item.updatedAt,
    (item.tags || []).map(function (tag) { return tag.name; })
  ]);
}

Page({
  data: {
    ready: false,
    loading: true,
    error: '',
    category: 'all',
    categories: CATEGORY_TABS,
    // list 是「当前地图可视区域内」的地点，只用于渲染下面的列表；
    // mapLocations 是筛选后、带坐标的全部地点，只用于画标记。
    // 两者必须分开：如果标记也用视野内的子集，一旦平移到新区域，
    // 那里的标记会因为不在旧视野里而消失，形成「越拖越空」的回环。
    list: [],
    mapLocations: [],
    bounds: null,
    locating: false,
    activeId: '',
    focusRequest: null,
    members: [],
    tags: [],
    detailVisible: false,
    detailTarget: null,
    formVisible: false,
    formTarget: null,
    formDraft: null,
    confirmVisible: false,
    confirmMessage: '',
    pendingDeleteId: '',
    // ---- 发现小馆（对应 Web 端 mapMode === 'discover'）----
    // 没有独立筛选：按钮即搜索，结果直接落在下面的公共列表区。
    mode: 'saved',
    discoveryLoading: false,
    discoveryError: '',
    discoveryResult: null,
    discoveryVisible: [],
    discoverySavingId: '',
    discoveryTooWide: false,
    discoveryMoved: false,
    discoveryFetchedAt: ''
  },

  onLoad(options) {
    this.unsubscribe = store.subscribe(this.reconcile.bind(this));
    // 分享深链：好友点开地点卡片直达详情。query 会死在「未登录 → 重定向登录 → switchTab 回来」
    // 这条路上（switchTab 不带参），所以先落一次 storage，由 onShow 在数据就绪后消费。
    const focusId = options && options.focus ? String(options.focus) : '';
    if (focusId) {
      try {
        wx.setStorageSync('rongmap:sharePending', focusId);
      } catch (error) {
        // 中转写入失败只是不会自动打开详情，不影响正常进入。
      }
    }
    // 朋友圈分享入口（定义了 onShareTimeline 才会出现在右上角菜单）。
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  async onShow() {
    // 原 Web 端依赖 Supabase Realtime 推送；小程序没有长连接，
    // 改由每次进入页面重取一次，保证多成员协作时的数据新鲜度。
    const state = store.getState();
    if (!state.identity && state.status !== 'loading') {
      this.setData({ loading: true });
    }
    const next = await store.load();
    if (next.status === 'anonymous') {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.reconcile(next);

    // 分享深链优先于「地图聚焦」：直接打开详情弹层（登录往返后也能保住）。
    let sharePending = '';
    try {
      sharePending = wx.getStorageSync('rongmap:sharePending') || '';
    } catch (error) {
      sharePending = '';
    }
    if (sharePending) {
      try {
        wx.removeStorageSync('rongmap:sharePending');
      } catch (error) {
        // 清除失败只会导致下次再打开一次详情，不影响功能。
      }
      this.openDetail(String(sharePending));
    }

    // 「地点」页没有地图，聚焦操作以这条一次性标记交接过来。
    let pendingFocus = '';
    try {
      pendingFocus = wx.getStorageSync('rongmap:focusPending') || '';
    } catch (error) {
      pendingFocus = '';
    }
    if (pendingFocus) {
      try {
        wx.removeStorageSync('rongmap:focusPending');
      } catch (error) {
        // 清除失败只会导致下次再聚焦一次，不影响功能。
      }
      this.onDetailFocus({ detail: { id: pendingFocus } });
    }
  },

  async onPullDownRefresh() {
    await store.refresh();
    wx.stopPullDownRefresh();
  },

  /** 错误态「重试」：重拉一次数据（与下拉刷新同一条链路）。 */
  onRetry() {
    store.refresh();
  },

  reconcile(state) {
    if (!state) return;
    // store 是模块级单例：数据没变化时 load() 会原样返回同一个快照对象。
    // 身份相同就说明没有任何字段需要重写，切 tab 回来时省掉整页 setData 与列表重建。
    if (state === this.snapshot) return;
    this.snapshot = state;
    this.setData({
      ready: state.status === 'ready',
      loading: state.status === 'loading' || state.status === 'idle',
      error: state.status === 'error' ? state.error : '',
      members: state.members,
      tags: state.tags
    });
    this.applyFilter(state.locations);
    // 收藏集合变化会影响候选卡片的「已收藏」标记；发现面板开着时同步刷新。
    if (this.data.mode === 'discover') this.applyDiscoveryFilter();
  },

  applyFilter(source) {
    const locations = source || store.getState().locations;
    const filters = Object.assign({}, EMPTY_FILTERS, { category: this.data.category });
    const matched = sortLocations(locations.filter(function (item) {
      return matchesLocation(item, filters);
    }), 'created');

    // 地图画全部带坐标的点；列表只留当前可视区域内的。
    // bounds 还没拿到（首屏数据适配之前）时不筛选，避免列表先空一下再填充。
    const mapLocations = matched.filter(hasCoordinates);
    const bounds = this.data.bounds;
    const visible = bounds ? mapLocations.filter(function (item) {
      return isLocationInBounds(item, bounds);
    }) : mapLocations;

    // 列表里装的是预计算过展示字段的对象（utils/format.js 的 decorateLocation），
    // 所以只在签名变化时才重建数组——否则每帧都会造一批新对象喂给整列卡片。
    const mapSignature = mapLocations.map(contentSignature).join('');
    const listSignature = visible.map(contentSignature).join('');

    // 选中态跟着地图走，不跟着列表走：平移出视野不该把高亮的标记取消掉。
    const activeId = this.data.activeId;
    const exists = mapLocations.some(function (item) { return item.id === activeId; });
    const nextActive = exists ? activeId : '';

    const patch = {};
    let dirty = false;
    if (mapSignature !== this.mapSignature) {
      this.mapSignature = mapSignature;
      patch.mapLocations = mapLocations;
      dirty = true;
    }
    if (listSignature !== this.listSignature) {
      this.listSignature = listSignature;
      patch.list = visible.map(decorateLocation);
      dirty = true;
    }
    if (nextActive !== activeId) {
      patch.activeId = nextActive;
      dirty = true;
    }
    if (dirty) this.setData(patch);
  },

  // 地图视野变化（拖动/缩放结束）→ 重算列表。
  onRegionChange(event) {
    const bounds = event.detail && event.detail.bounds;
    if (!bounds) return;
    // regionchange 的 end 在「点一下地图」「手指微抖」时也会触发，而 getRegion
    // 每次回的都是新对象，数值可能完全一样。数值没变就不写 bounds、也不重算列表。
    const previous = this.data.bounds;
    if (previous &&
        previous.south === bounds.south && previous.west === bounds.west &&
        previous.north === bounds.north && previous.east === bounds.east) {
      return;
    }
    this.setData({ bounds: bounds });
    this.applyFilter();
    // 发现面板开着时，视野变化要反映到「请放大」/「范围已改变」两条提示上。
    if (this.data.mode === 'discover') this.syncDiscoveryHints();
  },

  // 定位写在组件里（它持有地图实例），按钮放在页面上（避免普通 view 叠在原生 map 之上）。
  async onLocate() {
    if (this.data.locating) return;
    const map = this.selectComponent('#rongmap-canvas');
    if (!map) return;
    this.setData({ locating: true });
    try {
      await map.locate();
      wx.showToast({ title: '已定位到当前位置', icon: 'none' });
    } catch (error) {
      const message = String((error && error.errMsg) || '');
      const denied = message.indexOf('auth deny') >= 0 ||
        message.indexOf('auth denied') >= 0 ||
        message.indexOf('authorize') >= 0;
      if (!denied) {
        wx.showToast({ title: '暂时无法获取位置，请稍后重试', icon: 'none' });
        return;
      }
      // 拒绝过授权后地图的定位（show-location / moveToLocation）不会再弹窗，
      // 必须引导到设置页手动打开。
      wx.showModal({
        title: '需要位置权限',
        content: '开启后可在地图上显示你的位置。',
        confirmText: '去设置',
        success: function (res) {
          if (res.confirm) wx.openSetting({});
        }
      });
    } finally {
      this.setData({ locating: false });
    }
  },

  onCategoryTap(event) {
    // 分类筛选与「发现小馆」是同一行的两个部分：选分类即回到收藏列表。
    this.setData({
      category: event.currentTarget.dataset.key,
      mode: 'saved',
      activeId: ''
    });
    this.applyFilter();
  },

  onMapSelect(event) {
    // 发现模式：点候选标记只做高亮，不打开收藏详情。
    if (this.data.mode === 'discover') {
      const id = String(event.detail.locationId);
      const hit = this.data.discoveryVisible.some(function (item) { return item.id === id; });
      if (hit) this.setData({ activeId: id });
      return;
    }
    this.openDetail(event.detail.locationId);
  },

  // 在地图空白处点一下 = 以该点新建地点，替代 Web 端的「点击地图添加」。
  onMapTap(event) {
    // 发现模式在浏览候选，点空白弹新增表单属于误触，直接忽略。
    if (this.data.mode === 'discover') return;
    this.setData({
      formVisible: true,
      formTarget: null,
      formDraft: { latitude: event.detail.latitude, longitude: event.detail.longitude }
    });
  },

  // ---- 发现小馆（移植 Web 端 src/components/Discovery.jsx）----

  async onToggleDiscover() {
    // 按钮即开关：点「发现小馆」直接搜索当前区域、就地显示结果，
    // 不再切去单独的发现页；再点一次（此时文案是「返回收藏」）回到收藏列表。
    // 每次进入都搜一次：120 秒缓存兜底，不重复消耗高德配额。
    if (this.data.mode === 'discover') {
      this.setData({ mode: 'saved', activeId: '' });
      return;
    }
    this.setData({ mode: 'discover', activeId: '' });
    this.syncDiscoveryHints();
    await this.onDiscoverySearch();
  },

  /** 候选装饰 + 已收藏标记；结果同时就是发现模式的地图标记数据。 */
  applyDiscoveryFilter() {
    const result = this.data.discoveryResult;
    if (!result) {
      if (this.data.discoveryVisible.length) this.setData({ discoveryVisible: [] });
      return;
    }
    const savedSet = new Set(store.getState().locations.map(function (item) {
      return item.sourceId;
    }).filter(Boolean));
    const visible = result.restaurants.map(function (item) {
      return Object.assign({}, item, {
        saved: savedSet.has(item.sourceId),
        typeLabel: String(item.poiType || '').split(';').pop() || '餐饮',
        ratingLabel: item.rating === null ? '评分暂无' : '高德 ' + item.rating.toFixed(1),
        costLabel: item.averageCost === null ? '人均未知' : '人均 ¥' + item.averageCost
      });
    });
    this.setData({ discoveryVisible: visible });
  },

  syncDiscoveryHints() {
    const bounds = this.data.bounds;
    const result = this.data.discoveryResult;
    const tooWide = !!(bounds && (bounds.east - bounds.west > 0.12 || bounds.north - bounds.south > 0.12));
    const moved = !!(result && bounds && ['west', 'south', 'east', 'north'].some(function (key) {
      return Math.abs(bounds[key] - result.bounds[key]) > 0.0005;
    }));
    if (tooWide !== this.data.discoveryTooWide || moved !== this.data.discoveryMoved) {
      this.setData({ discoveryTooWide: tooWide, discoveryMoved: moved });
    }
  },

  async onDiscoverySearch() {
    if (this.data.discoveryLoading) return;
    if (!this.data.bounds || this.data.discoveryTooWide) return;
    this.setData({ discoveryLoading: true, discoveryError: '' });
    try {
      const result = await discovery.discoverRestaurants(this.data.bounds);
      this.setData({
        discoveryResult: result,
        discoveryFetchedAt: discovery.formatFetchedAt(result.fetchedAt),
        discoveryMoved: false
      });
      this.applyDiscoveryFilter();
    } catch (error) {
      // 失败时保留上次结果，列表里会提示「下方保留上次结果」，与 Web 版一致。
      this.setData({ discoveryError: (error && error.message) || '餐饮搜索暂时不可用' });
    } finally {
      this.setData({ discoveryLoading: false });
    }
  },

  onDiscoveryCardTap(event) {
    const id = String(event.currentTarget.dataset.id || '');
    const item = this.data.discoveryVisible.filter(function (candidate) { return candidate.id === id; })[0];
    if (!item) return;
    this.setData({ activeId: id, focusRequest: Object.assign({}, item, { focusToken: Date.now() }) });
  },

  async onDiscoveryCollect(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (this.data.discoverySavingId) return;
    const item = this.data.discoveryVisible.filter(function (candidate) { return candidate.id === id; })[0];
    if (!item || item.saved) return;
    const identity = store.getState().identity;
    if (!identity) return;
    this.setData({ discoverySavingId: item.sourceId });
    try {
      await api.createLocation(identity, discovery.restaurantToLocation(item));
      await store.refresh();
      // 触感反馈：收藏成功轻震一下（不支持的环境静默降级）
      try { if (wx.vibrateShort) wx.vibrateShort({ type: 'light' }); } catch (error) { /* 忽略 */ }
      wx.showToast({ title: '已收藏「' + item.name + '」', icon: 'none' });
    } catch (error) {
      // 409 的文案 api 层已带全（该地点已在共享空间中收藏），直接透出。
      wx.showToast({ title: (error && error.message) || '收藏失败，请重试', icon: 'none' });
      if (error && error.status === 409) await store.refresh();
    } finally {
      this.setData({ discoverySavingId: '' });
    }
  },

  openDetail(id) {
    const target = this.data.list.filter(function (item) { return item.id === id; })[0] ||
      store.getState().locations.filter(function (item) { return item.id === id; })[0];
    if (!target) return;
    this.setData({ detailVisible: true, detailTarget: target, activeId: id });
  },

  onDetailClose() {
    // 只收起、不清 detailTarget：弹层要留在树上播完滑出动画（约 280ms）再被摘除，
    // 期间仍依赖 location 渲染内容；遗留的旧 target 在重新打开时会被覆盖，无副作用。
    this.setData({ detailVisible: false });
  },

  onDetailEdit() {
    this.setData({
      detailVisible: false,
      formVisible: true,
      formTarget: this.data.detailTarget,
      formDraft: null
    });
  },

  onDetailFocus(event) {
    const target = store.getState().locations.filter(function (item) {
      return item.id === event.detail.id;
    })[0];
    this.setData({
      detailVisible: false,
      activeId: event.detail.id,
      focusRequest: target ? { id: target.id, latitude: target.latitude, longitude: target.longitude } : null
    });
  },

  onDetailDelete(event) {
    this.askDelete(event.detail.id, this.data.detailTarget);
  },

  onCardOpen(event) {
    this.openDetail(event.detail.id);
  },

  onCardFocus(event) {
    this.onDetailFocus(event);
  },

  onCardEdit(event) {
    const target = store.getState().locations.filter(function (item) {
      return item.id === event.detail.id;
    })[0];
    if (!target) return;
    this.setData({ formVisible: true, formTarget: target, formDraft: null });
  },

  onCardDelete(event) {
    this.askDelete(event.detail.id);
  },

  askDelete(id, target) {
    const item = target || store.getState().locations.filter(function (row) {
      return row.id === id;
    })[0];
    this.setData({
      confirmVisible: true,
      pendingDeleteId: id,
      confirmMessage: `「${(item && item.name) || '该地点'}」将移入回收站，${api.TRASH_RETENTION_DAYS} 天后自动清理。`
    });
  },

  onConfirmCancel() {
    this.setData({ confirmVisible: false, pendingDeleteId: '' });
  },

  async onConfirmDelete() {
    const id = this.data.pendingDeleteId;
    this.setData({ confirmVisible: false, pendingDeleteId: '' });
    const identity = store.getState().identity;
    if (!identity || !id) return;
    try {
      await api.softDeleteLocation(identity, id);
      wx.showToast({ title: '已移入回收站', icon: 'success' });
      // 只收起、不清 detailTarget：删除确认时详情弹层可能还开着，留着 target 才能播完滑出动画。
      this.setData({ detailVisible: false });
      await store.refresh();
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '操作失败', icon: 'none' });
    }
  },

  onFormClose() {
    this.setData({ formVisible: false, formTarget: null, formDraft: null });
  },

  async onFormSaved() {
    this.setData({ formVisible: false, formTarget: null, formDraft: null });
    await store.refresh();
  },

  async onFormCreateTag(event) {
    const identity = store.getState().identity;
    if (!identity) return;
    try {
      await api.createTag(identity, event.detail.name);
      await store.refresh();
      wx.showToast({ title: '标签已创建', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '创建标签失败', icon: 'none' });
    }
  },

  onShareAppMessage(res) {
    // 详情弹层里的「分享」按钮（open-type="share"）通过 dataset 带出地点身份；
    // dataset 缺失（极旧基础库等）时用当前打开的详情兜底。
    const dataset = (res && res.target && res.target.dataset) || {};
    const fallback = this.data.detailVisible && this.data.detailTarget ? this.data.detailTarget : null;
    const id = String(dataset.id || (fallback ? fallback.id : '') || '');
    if (id) {
      const name = dataset.name || (fallback && fallback.name) || '地点';
      return {
        title: name + ' · RongMap 亲友共享地图',
        path: '/pages/map/map?focus=' + encodeURIComponent(id)
      };
    }
    return {
      title: 'RongMap · 亲友共享地图',
      path: '/pages/map/map'
    };
  },

  onShareTimeline() {
    // 朋友圈不支持自定义 path，只能带 query；单页模式下数据可能取不到，文案不承诺交互。
    const fallback = this.data.detailVisible && this.data.detailTarget ? this.data.detailTarget : null;
    return {
      title: 'RongMap · 亲友共享地图',
      query: fallback ? 'focus=' + encodeURIComponent(String(fallback.id)) : ''
    };
  }
});
