const api = require('../../utils/api');
const store = require('../../utils/store');
const { matchesLocation, sortLocations } = require('../../utils/location');
const { EMPTY_FILTERS } = require('../../utils/constants');
const { decorateLocation } = require('../../utils/format');

/**
 * 内容签名：签名不变就不重建列表数组。
 * 本页没有筛选与地图，reconcile 只在数据真的换了一批时才会走到这里，
 * 这层判断主要挡住「同一份内容被重复 reconcile」造成的整列重渲染。
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
    list: [],
    total: 0,
    members: [],
    tags: [],
    detailVisible: false,
    detailTarget: null,
    formVisible: false,
    formTarget: null,
    formDraft: null,
    confirmVisible: false,
    confirmTitle: '',
    confirmMessage: '',
    confirmText: '确定',
    confirmDanger: true,
    pendingAction: '',
    pendingLocationId: ''
  },

  onLoad() {
    this.unsubscribe = store.subscribe(this.reconcile.bind(this));
    // 朋友圈分享入口（定义了 onShareTimeline 才会出现在右上角菜单）。
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    }
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  async onShow() {
    const next = await store.load();
    if (next.status === 'anonymous') {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.reconcile(next);
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
    // store 是模块级单例：数据没变化时 load() 会原样返回同一个快照对象，
    // 身份相同就跳过整页 setData，切 tab 回来不再重建整列卡片。
    if (state === this.snapshot) return;
    this.snapshot = state;
    this.setData({
      ready: state.status === 'ready',
      loading: state.status === 'loading' || state.status === 'idle',
      error: state.status === 'error' ? state.error : '',
      members: state.members,
      tags: state.tags,
      total: state.locations.length
    });
    this.applyFilter(state.locations);
  },

  /**
   * 本页不再提供筛选/搜索，filters 恒为 EMPTY_FILTERS；
   * 仍走 matchesLocation 是为了保留它内置的「排除回收站」语义（deletedAt 判空），
   * 换用裸 filter 容易在「刚移入回收站」的那一帧把已删项又显示出来。
   */
  applyFilter(source) {
    const locations = source || store.getState().locations;
    const matched = sortLocations(locations.filter(function (item) {
      return matchesLocation(item, EMPTY_FILTERS);
    }), EMPTY_FILTERS.sort);
    const signature = matched.map(contentSignature).join('');
    if (signature === this.listSignature) return;
    this.listSignature = signature;
    // 展示字段（分类文案 / 相对时间 / 添加者）在这里一次算完，卡片只渲染不再回算。
    this.setData({ list: matched.map(decorateLocation) });
  },

  onAdd() {
    this.setData({ formVisible: true, formTarget: null, formDraft: null });
  },

  onCardOpen(event) {
    const target = store.getState().locations.filter(function (item) {
      return item.id === event.detail.id;
    })[0];
    if (!target) return;
    this.setData({ detailVisible: true, detailTarget: target });
  },

  onCardFocus(event) {
    // 「地点」页没有地图组件，聚焦改为跳回地图 tab。
    wx.setStorageSync('rongmap:focusPending', event.detail.id);
    wx.switchTab({ url: '/pages/map/map' });
  },

  onCardEdit(event) {
    const target = store.getState().locations.filter(function (item) {
      return item.id === event.detail.id;
    })[0];
    if (!target) return;
    this.setData({ formVisible: true, formTarget: target, formDraft: null });
  },

  onCardDelete(event) {
    const target = store.getState().locations.filter(function (item) {
      return item.id === event.detail.id;
    })[0];
    this.setData({
      confirmVisible: true,
      confirmTitle: '移入回收站',
      confirmText: '移入回收站',
      confirmDanger: true,
      confirmMessage: `「${(target && target.name) || '该地点'}」将移入回收站，${api.TRASH_RETENTION_DAYS} 天后自动清理。`,
      pendingAction: 'delete-one',
      pendingLocationId: event.detail.id
    });
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

  onDetailFocus() {
    this.onCardFocus({ detail: { id: this.data.detailTarget.id } });
  },

  onDetailDelete() {
    const target = this.data.detailTarget;
    this.setData({
      detailVisible: false,
      confirmVisible: true,
      confirmTitle: '移入回收站',
      confirmText: '移入回收站',
      confirmDanger: true,
      confirmMessage: `「${target.name}」将移入回收站，${api.TRASH_RETENTION_DAYS} 天后自动清理。`,
      pendingAction: 'delete-one',
      pendingLocationId: target.id
    });
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

  onConfirmCancel() {
    this.setData({ confirmVisible: false, pendingAction: '', pendingLocationId: '' });
  },

  async onConfirmAction() {
    const action = this.data.pendingAction;
    this.setData({ confirmVisible: false, pendingAction: '' });
    if (action === 'delete-one') {
      await this.deleteOne(this.data.pendingLocationId);
    }
    this.setData({ pendingLocationId: '' });
  },

  async deleteOne(id) {
    const identity = store.getState().identity;
    if (!identity || !id) return;
    try {
      await api.softDeleteLocation(identity, id);
      await store.refresh();
      wx.showToast({ title: '已移入回收站', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '操作失败', icon: 'none' });
    }
  },

  onShareAppMessage(res) {
    // 同地图页：详情弹层「分享」按钮带出地点身份，缺失时用当前详情兜底。
    const dataset = (res && res.target && res.target.dataset) || {};
    const fallback = this.data.detailVisible && this.data.detailTarget ? this.data.detailTarget : null;
    const id = String(dataset.id || (fallback ? fallback.id : '') || '');
    if (id) {
      const name = dataset.name || (fallback && fallback.name) || '地点';
      // 好友点开统一落在地图页并打开详情（比落在列表页更有上下文）。
      return {
        title: name + ' · RongMap 亲友共享地图',
        path: '/pages/map/map?focus=' + encodeURIComponent(id)
      };
    }
    return {
      title: 'RongMap · 亲友共享地图',
      path: '/pages/locations/locations'
    };
  },

  onShareTimeline() {
    const fallback = this.data.detailVisible && this.data.detailTarget ? this.data.detailTarget : null;
    return {
      title: 'RongMap · 亲友共享地图',
      query: fallback ? 'focus=' + encodeURIComponent(String(fallback.id)) : ''
    };
  }
});
