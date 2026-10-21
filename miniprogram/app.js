const publicConfig = require('./utils/public-config');

App({
  globalData: {
    applicationId: publicConfig.applicationId,
    // 登录后由 utils/session.js 填充，供各页面共享。
    space: null,
    member: null
  }
});
