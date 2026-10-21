const store = require('../../utils/store');
const { relativeTime, formatDateTime } = require('../../utils/format');

const ACTION_LABELS = {
  location_created: '添加了地点',
  location_updated: '修改了地点',
  location_deleted: '移入回收站',
  location_restored: '恢复了地点',
  comment_created: '点评了地点',
  bulk_updated: '批量操作'
};
const ACTION_KEYS = Object.keys(ACTION_LABELS);

function decorate(entry) {
  return Object.assign({}, entry, {
    actionLabel: ACTION_LABELS[entry.action] || '更新了空间',
    agoText: relativeTime(entry.createdAt),
    atText: formatDateTime(entry.createdAt)
  });
}

Page({
  data: {
    ready: false,
    loading: true,
    error: '',
    list: [],
    // 筛选后的空态与「一条都没有」的空态文案不同，需要一个显式标记。
    filtered: false,
    hasAny: false,
    memberLabels: ['全部成员'],
    memberIndex: 0,
    actionLabels: ['全部动作'].concat(ACTION_KEYS.map(function (key) { return ACTION_LABELS[key]; })),
    actionIndex: 0
  },

  onLoad() {
    this.unsubscribe = store.subscribe(this.reconcile.bind(this));
    // 全量装饰后的记录与成员表放在实例上：筛选只在这个副本上过滤，不重复 decorate。
    this.raw = [];
    this.members = [];
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
    this.raw = state.activity.map(decorate);
    this.members = [{ id: 'all', name: '全部成员' }].concat(state.members || []);
    const memberLabels = this.members.map(function (item) { return item.name; });
    // 数据刷新后保持当前筛选；成员数变少导致越界时回到「全部」。
    const memberIndex = this.data.memberIndex < memberLabels.length ? this.data.memberIndex : 0;
    this.setData({
      ready: state.status === 'ready',
      loading: state.status === 'loading' || state.status === 'idle',
      error: state.status === 'error' ? state.error : '',
      memberLabels: memberLabels,
      memberIndex: memberIndex,
      hasAny: this.raw.length > 0
    });
    this.applyFilters();
  },

  applyFilters() {
    const self = this;
    const member = this.members[this.data.memberIndex];
    const actionKey = this.data.actionIndex > 0 ? ACTION_KEYS[this.data.actionIndex - 1] : '';
    const list = this.raw.filter(function (entry) {
      const memberHit = self.data.memberIndex === 0 || (!!member && entry.actorId === member.id);
      const actionHit = !actionKey || entry.action === actionKey;
      return memberHit && actionHit;
    });
    this.setData({
      list: list,
      filtered: this.data.memberIndex > 0 || this.data.actionIndex > 0
    });
  },

  onMemberFilter(event) {
    this.setData({ memberIndex: Number(event.detail.value) });
    this.applyFilters();
  },

  onActionFilter(event) {
    this.setData({ actionIndex: Number(event.detail.value) });
    this.applyFilters();
  }
});
