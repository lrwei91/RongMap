const crypto = require('crypto');
const { getRequestIdentity, getSupabaseAdmin, requireAdmin } = require('../server-supabase');
const { normalizeUsername, toMemberEmail, memberUsername } = require('../member-auth');
const store = require('../shared-store');
const { registerSupabaseMember } = require('../member-registration');
const { sendError, methodNotAllowed } = require('./_response');

// 注册成员：只登记用户名和姓名，注册完成即可直接用用户名登录，不发邮件、不等接受邀请。
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const identity = await getRequestIdentity(req); requireAdmin(identity);
    const username = normalizeUsername(req.body?.username);
    const name = String(req.body?.name || '').trim() || username;
    if (name.length > 60) { const error = new Error('姓名最多 60 个字符'); error.status = 400; throw error; }
    const email = toMemberEmail(username);
    const supabase = getSupabaseAdmin();
    let member;
    if (supabase) {
      const registration = await registerSupabaseMember(supabase, identity, username, name);
      member = registration.member;
      if (!registration.created) return res.status(200).json(member);
    } else {
      const meta = await store.getMeta();
      if ((meta.members || []).some((item) => memberUsername(item.email) === username)) { const error = new Error('该用户名已被注册'); error.status = 409; throw error; }
      member = { id: crypto.randomUUID(), username, name, email, role: 'member', status: 'active', createdAt: new Date().toISOString() };
      meta.members = [...(meta.members || []), member];
      await store.saveMeta(meta);
    }
    try { await store.addActivity(identity, 'member_added', member.name); }
    catch { console.warn('Member registration completed; activity recording failed'); }
    return res.status(201).json(member);
  } catch (error) {
    if (!error.status || error.status >= 500) {
      // 数据库错误可能携带失败行中的私人字段，日志只保留诊断代码。
      console.error('Member registration incomplete', { code: error.code || 'unknown' });
      return res.status(503).json({ error: '注册暂时未完成，请稍后重试' });
    }
    return sendError(res, error);
  }
};
