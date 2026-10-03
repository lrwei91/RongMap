const crypto = require('crypto');
const { getRequestIdentity, getSupabaseAdmin, requireAdmin } = require('../server-supabase');
const { getDefaultMemberPassword, normalizeUsername, toMemberEmail, memberUsername } = require('../member-auth');
const store = require('../shared-store');
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
      const password = getDefaultMemberPassword();
      const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (users.error) throw users.error;
      if (users.data.users.some((item) => item.email?.trim().toLowerCase() === email)) {
        const error = new Error('该用户名已被注册'); error.status = 409; throw error;
      }
      const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, username } });
      if (created.error) {
        if (created.error.status === 422 || /already|exists|registered|重复/i.test(created.error.message || '')) {
          const error = new Error('该用户名已被注册'); error.status = 409; throw error;
        }
        if (created.error.status === 429) { const error = new Error('注册过于频繁，请稍后再试'); error.status = 429; throw error; }
        throw created.error;
      }
      member = { id: created.data.user.id, username, name, email, role: 'member', status: 'active' };
      const profile = await supabase.from('profiles').upsert({ id: member.id, email, name });
      if (profile.error) throw profile.error;
      const membership = await supabase.from('space_members').insert({ space_id: identity.spaceId, user_id: member.id, role: 'member', invited_by: identity.user.id }).select('created_at').single();
      if (membership.error) throw membership.error;
      member.createdAt = membership.data.created_at;
    } else {
      const meta = await store.getMeta();
      if ((meta.members || []).some((item) => memberUsername(item.email) === username)) { const error = new Error('该用户名已被注册'); error.status = 409; throw error; }
      member = { id: crypto.randomUUID(), username, name, email, role: 'member', status: 'active', createdAt: new Date().toISOString() };
      meta.members = [...(meta.members || []), member];
      await store.saveMeta(meta);
    }
    await store.addActivity(identity, 'member_added', member.name);
    return res.status(201).json(member);
  } catch (error) { return sendError(res, error); }
};