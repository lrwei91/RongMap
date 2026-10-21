const api = require('../../utils/api');
const session = require('../../utils/session');
const store = require('../../utils/store');

/**
 * 进门密码：整个空间共用一个，写死在客户端里。
 * 它只拦陌生人误入，不防有心人——成员的个人身份靠微信账号区分，不靠密码。
 */
const ACCESS_CODE = '1991';

Page({
  data: {
    accessCode: '',
    loggingIn: false,
    error: '',
    checking: true,
    // 首次登录（空间里还没有这个微信账号的成员记录）时的第二步：完善称呼。
    registering: false,
    registerName: ''
  },

  async onShow() {
    // 「完善称呼」进行中不重入：否则 loadIdentity 会用兜底名把成员先建出来，
    // 称呼这一步就永远落不到库里了。
    if (this.data.registering) return;
    this.setData({ checking: true });
    try {
      const existing = await session.loadIdentity();
      if (existing) {
        wx.switchTab({ url: '/pages/map/map' });
        return;
      }
    } catch (error) {
      // 网络异常时不应卡在「检查登录状态」，落到登录按钮让用户重试。
      console.error('[RongMap] 登录状态检查失败', JSON.stringify({ stage: 'login-check' }));
    }
    this.setData({ checking: false });
  },

  onCodeInput(event) {
    this.setData({ accessCode: event.detail.value, error: '' });
  },

  onRegisterNameInput(event) {
    this.setData({ registerName: event.detail.value });
  },

  // type=nickname 的快捷填充在部分机型上要等失焦才回传，input 与 blur 两处都收。
  onRegisterNameBlur(event) {
    const value = String(event.detail.value || '').trim();
    if (value) this.setData({ registerName: value });
  },

  async onLogin() {
    if (this.data.loggingIn || this.data.registering) return;
    const code = String(this.data.accessCode || '').trim();
    // 密码不对就不碰 wx.login：避免「输错密码也走了一遍微信登录」的浪费路径。
    if (code !== ACCESS_CODE) {
      this.setData({ error: '访问密码不正确，请重试' });
      return;
    }
    this.setData({ loggingIn: true, error: '' });
    try {
      await session.wechatLogin();
      // 微信的静默登录拿不到昵称（平台 2022-10 起已收回该能力），
      // 所以首次进来要先问一句称呼；老成员空间里已有记录，直接进工作台，零打扰。
      if (!(await api.hasMembership())) {
        this.setData({ registering: true });
        return;
      }
      await this.enterWorkspace();
    } catch (error) {
      console.error('[RongMap] 登录失败', JSON.stringify({ stage: 'login' }));
      this.setData({ error: (error && error.message) || '登录失败，请重试' });
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  async onCompleteRegister() {
    if (this.data.loggingIn) return;
    await this.finishRegister(this.data.registerName);
  },

  async onSkipRegister() {
    if (this.data.loggingIn) return;
    await this.finishRegister('');
  },

  async finishRegister(name) {
    this.setData({ loggingIn: true, error: '' });
    try {
      // 留空由服务端兜底为「空间成员」，之后随时可在「我的」页改名。
      const identity = await api.resolveIdentity(String(name || '').trim());
      session.setIdentity(identity);
      await this.enterWorkspace();
    } catch (error) {
      console.error('[RongMap] 完善称呼失败', JSON.stringify({ stage: 'register' }));
      this.setData({ error: (error && error.message) || '登录失败，请重试' });
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  async enterWorkspace() {
    await store.load(true);
    this.setData({ registering: false });
    wx.switchTab({ url: '/pages/map/map' });
  }
});
