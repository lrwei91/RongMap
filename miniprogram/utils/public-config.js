/**
 * 云服务公开配置。
 *
 * 这三个值来自云服务开通时返回的 publicConfig，是唯一允许写进小程序前端的凭据：
 * endpoint 是小程序固定网关，publishableKey 只标识「哪个应用」、本身不带任何权限，
 * 服务端按小程序来源（appid + Referer）校验身份。applicationId 仅用于本地标识与隐私清单命名。
 *
 * 不要替换成其他域名，不要在这里放任何密钥，也不要把它们打进日志。
 */
module.exports = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_8AhQ0BJhwyTslmq5vMlokg_G5J26NbzmzNu33Omldpp7fFJMefJvFhz',
  applicationId: 'wbapp_8AhQ0BJhwyTslmq5vMlokg'
};
