const api = require('../../utils/api');
const store = require('../../utils/store');
const { formatDateTime, relativeTime } = require('../../utils/format');

// 回收站保留 30 天。Web 端由服务端定时任务清理；小程序沿用同一策略，
// 但清理时机挂在 bootstrap 的惰性触发上（见 utils/api.js 的 purgeExpiredTrash）。
function decorate(location) {
  const deletedAt = new Date(location.deletedAt).getTime();
  const elapsedDays = Number.isFinite(deletedAt)
    ? Math.floor((Date.now() - deletedAt) / 86400000)
    : 0;
  const daysLeft = Math.max(0, api.TRASH_RETENTION_DAYS - elapsedDays);
  return Object.assign({}, location, {
    deletedByLabel: location.deletedByName || '空间成员',
    deletedAtText: formatDateTime(location.deletedAt),
    deletedAgo: relativeTime(location.deletedAt),
    daysLeftText: daysLeft > 0 ? `${daysLeft} 天后清理` : '即将清理'
  });
}

Page({
  data: {
    ready: false,
    loading: true,
    error: '',
    list: [],
    retentionDays: api.TRASH_RETENTION_DAYS,
    confirmVisible: false,
    confirmTitle: '',
    confirmMessage: '',
    confirmText: '确定',
    confirmDanger: true,
    pendingAction: '',
    pendingId: ''
  },

  onLoad() {
    this.unsubscribe = store.subscribe(this.reconcile.bind(this));
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
    // 快照未变 = 数据没动过，跳过整列 setData 与 decorate 的重复计算。
    if (state === this.snapshot) return;
    this.snapshot = state;
    this.setData({
      ready: state.status === 'ready',
      loading: state.status === 'loading' || state.status === 'idle',
      error: state.status === 'error' ? state.error : '',
      list: state.trash.map(decorate)
    });
  },

  onRestore(event) {
    const target = this.find(event.currentTarget.dataset.id);
    if (!target) return;
    this.setData({
      confirmVisible: true,
      confirmTitle: '恢复地点',
      confirmText: '恢复',
      confirmDanger: false,
      confirmMessage: `「${target.name}」将恢复到地点列表。`,
      pendingAction: 'restore',
      pendingId: target.id
    });
  },

  onPurge(event) {
    const target = this.find(event.currentTarget.dataset.id);
    if (!target) return;
    this.setData({
      confirmVisible: true,
      confirmTitle: '彻底删除',
      confirmText: '彻底删除',
      confirmDanger: true,
      confirmMessage: `「${target.name}」将被永久删除，无法恢复。`,
      pendingAction: 'purge',
      pendingId: target.id
    });
  },

  onPurgeAll() {
    if (!this.data.list.length) {
      wx.showToast({ title: '回收站是空的', icon: 'none' });
      return;
    }
    this.setData({
      confirmVisible: true,
      confirmTitle: '清空回收站',
      confirmText: '全部彻底删除',
      confirmDanger: true,
      confirmMessage: `${this.data.list.length} 个地点将被永久删除，无法恢复。`,
      pendingAction: 'purge-all',
      pendingId: ''
    });
  },

  onConfirmCancel() {
    this.setData({ confirmVisible: false, pendingAction: '', pendingId: '' });
  },

  async onConfirmAction() {
    const action = this.data.pendingAction;
    const id = this.data.pendingId;
    this.setData({ confirmVisible: false, pendingAction: '', pendingId: '' });
    const identity = store.getState().identity;
    if (!identity) return;

    if (action === 'purge-all') {
      wx.showLoading({ title: '清理中…', mask: true });
      const ids = this.data.list.map(function (item) { return item.id; });
      let removed = 0;
      for (let index = 0; index < ids.length; index += 1) {
        try {
          await api.purgeLocation(identity, ids[index]);
          removed += 1;
        } catch (error) {
          // 单条失败不影响其余条目继续清理。
        }
      }
      wx.hideLoading();
      await store.refresh();
      wx.showToast({ title: `已彻底删除 ${removed} 个`, icon: 'success' });
      return;
    }

    try {
      if (action === 'restore') {
        await api.restoreLocation(identity, id);
        wx.showToast({ title: '已恢复', icon: 'success' });
      } else {
        await api.purgeLocation(identity, id);
        wx.showToast({ title: '已彻底删除', icon: 'success' });
      }
      await store.refresh();
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '操作失败', icon: 'none' });
    }
  },

  find(id) {
    return this.data.list.filter(function (item) { return item.id === id; })[0];
  }
});
