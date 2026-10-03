const { getSupabaseAdmin } = require('../server-supabase');
const { signInMember, toMemberEmail, memberUsername } = require('../member-auth');
const { sendError, methodNotAllowed } = require('./_response');

// 用户名登录：无需邮箱验证、无需密码，服务端用共享默认密码换取 Supabase 会话。
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      const error = new Error('登录服务尚未配置');
      error.status = 503;
      throw error;
    }
    const input = String(req.body?.username || '').trim().toLowerCase();
    if (!input) {
      const error = new Error('请输入用户名');
      error.status = 400;
      throw error;
    }
    const session = await signInMember(supabase, toMemberEmail(input));
    if (!session) {
      const error = new Error('该用户名未注册');
      error.status = 401;
      throw error;
    }
    // 共享密码对所有账号通用，必须再确认此人仍在空间内，否则被移除的成员也能登录。
    const membership = await supabase.from('space_members').select('space_id').eq('user_id', session.user.id).limit(1);
    if (membership.error) throw membership.error;
    if (!membership.data?.length) {
      const error = new Error('该用户名不是共享空间成员');
      error.status = 403;
      throw error;
    }
    const username = memberUsername(session.user.email);
    return res.status(200).json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      username,
      name: session.user.user_metadata?.name || username,
      spaceId: membership.data[0].space_id
    });
  } catch (error) { return sendError(res, error); }
};