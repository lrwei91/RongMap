const { cloud } = require('./cloud');
const { resolveIdentity } = require('./api');

// 只缓存"空间 + 成员"这些非敏感信息；会话令牌由云 SDK 自己管理，不在这里落盘。
const IDENTITY_KEY = 'rongmap:identity';
let memoryIdentity = null;

function cachedIdentity() {
  if (memoryIdentity) return memoryIdentity;
  try {
    const stored = wx.getStorageSync(IDENTITY_KEY);
    if (stored && stored.uid) {
      memoryIdentity = stored;
      return memoryIdentity;
    }
  } catch (error) {
    // 存储不可用时退回内存态，不影响本次会话。
  }
  return null;
}

function setIdentity(identity) {
  memoryIdentity = identity;
  try {
    wx.setStorageSync(IDENTITY_KEY, identity);
  } catch (error) {
    // 忽略：内存态仍然可用。
  }
}

function clearIdentity() {
  memoryIdentity = null;
  try {
    wx.removeStorageSync(IDENTITY_KEY);
  } catch (error) {
    // 忽略。
  }
}

/**
 * wx.login + 云服务微信登录。
 * 试用版与正式版是两套独立小程序，appid 必须取运行时的值，不能写死。
 */
function wechatLogin() {
  return new Promise(function (resolve, reject) {
    wx.login({
      success: function (res) {
        let appid = '';
        try {
          appid = wx.getAccountInfoSync().miniProgram.appId;
        } catch (error) {
          appid = '';
        }
        cloud.auth.signInWithWechat(res.code, appid).then(function (result) {
          if (result.error) {
            reject(new Error(result.error.message || '微信登录失败，请重试'));
            return;
          }
          clearIdentity();
          resolve(result.data);
        }).catch(function (error) {
          console.error('[WorkBuddy Cloud] login failed', JSON.stringify({
            stage: 'wechat-login-handler',
            message: (error && error.message) || '微信登录失败，请重试'
          }));
          reject(new Error('微信登录失败，请重试'));
        });
      },
      fail: function (error) {
        console.error('[WorkBuddy Cloud] login failed', JSON.stringify({
          stage: 'wx.login',
          message: (error && error.errMsg) || 'wx.login failed'
        }));
        reject(new Error('未完成微信授权，请重试'));
      }
    });
  });
}

async function currentSession() {
  const result = await cloud.auth.getSession();
  if (result.error || !result.data) return null;
  return result.data;
}

/** 已登录则返回 { uid, space, member }；未登录返回 null。 */
async function loadIdentity(displayName) {
  const session = await currentSession();
  if (!session) return null;
  const stored = cachedIdentity();
  if (stored && stored.uid === session.user.id) return stored;
  const identity = await resolveIdentity(displayName);
  setIdentity(identity);
  return identity;
}

async function logout() {
  clearIdentity();
  try {
    await cloud.auth.signOut();
  } catch (error) {
    // 断网时也必须能登出：本地凭据已清。
  }
}

/** 页面守卫：未登录时转到登录页，返回 null；已登录返回身份。 */
async function guard() {
  const identity = await loadIdentity();
  if (!identity) {
    wx.redirectTo({ url: '/pages/login/login' });
    return null;
  }
  return identity;
}

module.exports = {
  wechatLogin,
  currentSession,
  loadIdentity,
  logout,
  guard,
  setIdentity,
  clearIdentity
};
