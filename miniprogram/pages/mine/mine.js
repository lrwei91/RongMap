const api = require('../../utils/api');
const store = require('../../utils/store');
const session = require('../../utils/session');

function initial(name) {
  return String(name || '空').slice(0, 1);
}

Page({
  data: {
    ready: false,
    loading: true,
    error: '',
    currentUser: null,
    spaceName: '',
    members: [],
    tags: [],
    stats: { locations: 0, trash: 0, members: 0, tags: 0 },
    initial: '空',
    isAdmin: false,
    busy: false,
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
    // 快照未变 = 数据没动过，直接跳过这 8 个字段的写入与成员数组重建。
    if (state === this.snapshot) return;
    this.snapshot = state;
    const currentUser = state.currentUser;
    this.setData({
      ready: state.status === 'ready',
      loading: state.status === 'loading' || state.status === 'idle',
      error: state.status === 'error' ? state.error : '',
      currentUser: currentUser,
      initial: initial(currentUser && currentUser.name),
      isAdmin: !!(currentUser && currentUser.role === 'admin'),
      spaceName: (state.space && state.space.name) || '',
      members: state.members.map(function (member) {
        // 头像只放一个字：36px 的圆里塞不下完整称呼。
        return Object.assign({}, member, { initial: initial(member.name) });
      }),
      tags: state.tags,
      stats: {
        locations: state.locations.length,
        trash: state.trash.length,
        members: state.members.length,
        tags: state.tags.length
      }
    });
  },

  // ---- 个人信息 ----

  onRenameSelf() {
    const self = this;
    wx.showModal({
      title: '修改你的称呼',
      editable: true,
      placeholderText: '例如：小林',
      content: (this.data.currentUser && this.data.currentUser.name) || '',
      success: async function (res) {
        if (!res.confirm) return;
        const name = String(res.content || '').trim();
        if (!name) {
          wx.showToast({ title: '称呼不能为空', icon: 'none' });
          return;
        }
        const identity = store.getState().identity;
        if (!identity) return;
        try {
          await api.updateMember(identity, identity.member.id, { name: name });
          await store.refresh();
          wx.showToast({ title: '已更新', icon: 'success' });
        } catch (error) {
          // 权限不足时退回本地展示名，至少不影响当前会话。
          store.patchMemberName(name);
          wx.showToast({ title: (error && error.message) || '更新失败', icon: 'none' });
        }
      }
    });
  },

  // ---- 成员管理 ----

  onMemberTap(event) {
    const id = event.currentTarget.dataset.id;
    const member = this.data.members.filter(function (item) { return item.id === id; })[0];
    if (!member) return;
    const me = this.data.currentUser;
    const isSelf = !!me && member.id === me.id;
    // 权限收敛：自己的称呼任何人都能改；管理其他成员（改称呼/移除）只留给管理员。
    if (!isSelf && !this.data.isAdmin) return;
    const self = this;
    const actions = ['修改称呼'];
    if (this.data.isAdmin && !isSelf) actions.push('移除成员');
    wx.showActionSheet({
      itemList: actions,
      success: function (res) {
        const action = actions[res.tapIndex];
        if (action === '修改称呼') self.promptMemberName(member);
        else self.askRemoveMember(member);
      },
      fail: function () { /* 取消 */ }
    });
  },

  promptMemberName(member) {
    const self = this;
    wx.showModal({
      title: `修改「${member.name}」的称呼`,
      editable: true,
      placeholderText: '成员称呼',
      content: member.name,
      success: async function (res) {
        if (!res.confirm) return;
        const name = String(res.content || '').trim();
        if (!name) return;
        const identity = store.getState().identity;
        if (!identity) return;
        try {
          await api.updateMember(identity, member.id, { name: name });
          await store.refresh();
          wx.showToast({ title: '已更新', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: (error && error.message) || '更新失败', icon: 'none' });
        }
      }
    });
  },

  askRemoveMember(member) {
    if (this.data.currentUser && member.id === this.data.currentUser.id) {
      wx.showToast({ title: '不能移除自己', icon: 'none' });
      return;
    }
    this.setData({
      confirmVisible: true,
      confirmTitle: '移除成员',
      confirmText: '移除',
      confirmDanger: true,
      confirmMessage: `「${member.name}」将从共享空间移除，其添加的地点会保留。`,
      pendingAction: 'remove-member',
      pendingId: member.id
    });
  },

  // ---- 标签管理 ----

  onCreateTag() {
    const self = this;
    wx.showModal({
      title: '新建标签',
      editable: true,
      placeholderText: '例如：周末去',
      success: async function (res) {
        if (!res.confirm) return;
        const name = String(res.content || '').trim();
        if (!name) return;
        const identity = store.getState().identity;
        if (!identity) return;
        try {
          await api.createTag(identity, name);
          await store.refresh();
          wx.showToast({ title: '标签已创建', icon: 'success' });
        } catch (error) {
          wx.showToast({ title: (error && error.message) || '创建失败', icon: 'none' });
        }
      }
    });
  },

  onDeleteTag(event) {
    const id = event.currentTarget.dataset.id;
    const tag = this.data.tags.filter(function (item) { return item.id === id; })[0];
    if (!tag) return;
    this.setData({
      confirmVisible: true,
      confirmTitle: '删除标签',
      confirmText: '删除',
      confirmDanger: true,
      confirmMessage: `标签「${tag.name}」将被删除，已打标的地点不受影响。`,
      pendingAction: 'delete-tag',
      pendingId: id
    });
  },

  // ---- 导航 ----

  onOpenTrash() {
    wx.navigateTo({ url: '/pages/trash/trash' });
  },

  onOpenActivity() {
    wx.navigateTo({ url: '/pages/activity/activity' });
  },

  onOpenAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  onShowPrivacy() {
    if (typeof wx.openPrivacyContract === 'function') {
      wx.openPrivacyContract({
        fail: function () {
          wx.showToast({ title: '暂无隐私协议', icon: 'none' });
        }
      });
      return;
    }
    wx.showModal({
      title: '隐私说明',
      content: '位置权限仅用于在地图上显示你的位置与选点；地点保存在云端，供空间成员共同查看。',
      showCancel: false
    });
  },

  onLogout() {
    this.setData({
      confirmVisible: true,
      confirmTitle: '退出登录',
      confirmText: '退出',
      confirmDanger: true,
      confirmMessage: '退出后要重新登录才能查看这些地点。',
      pendingAction: 'logout',
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

    try {
      if (action === 'remove-member') {
        await api.removeMember(identity, id);
        await store.refresh();
        wx.showToast({ title: '已移除', icon: 'success' });
      } else if (action === 'delete-tag') {
        await api.deleteTag(identity, id);
        await store.refresh();
        wx.showToast({ title: '标签已删除', icon: 'success' });
      } else if (action === 'logout') {
        await session.logout();
        store.reset();
        wx.reLaunch({ url: '/pages/login/login' });
      }
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '操作失败', icon: 'none' });
    }
  }
});
