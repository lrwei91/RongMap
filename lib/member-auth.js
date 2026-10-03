const MINIMUM_PASSWORD_LENGTH = 8;
// 用户名内部映射为该域名的伪邮箱：Supabase Auth 只认邮箱，但成员从不接触邮箱或密码。
const MEMBER_EMAIL_DOMAIN = 'rongmap.local';
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;

function getDefaultMemberPassword(environment = process.env) {
  const password = String(environment.RONGMAP_DEFAULT_MEMBER_PASSWORD || '');
  if (!password) {
    const error = new Error('成员默认密码尚未配置');
    error.status = 503;
    throw error;
  }
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    const error = new Error(`成员默认密码至少需要 ${MINIMUM_PASSWORD_LENGTH} 个字符`);
    error.status = 503;
    throw error;
  }
  return password;
}

function normalizeUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    const error = new Error('用户名需为 3-40 位小写字母、数字、.、_ 或 -');
    error.status = 400;
    throw error;
  }
  return username;
}

function toMemberEmail(username) {
  return `${normalizeUsername(username)}@${MEMBER_EMAIL_DOMAIN}`;
}

function memberUsername(email) {
  return String(email || '').split('@')[0];
}

// ponytail: 共享默认密码等价于「知道用户名即可登录」，这是本项目明确取舍。
// 需要真实凭据时，只需替换本函数并给前端加回密码框，其余会话链路不变。
async function signInMember(supabase, email, environment = process.env) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: getDefaultMemberPassword(environment) });
  if (error || !data?.session) return null;
  return data.session;
}

module.exports = { getDefaultMemberPassword, normalizeUsername, toMemberEmail, memberUsername, signInMember };