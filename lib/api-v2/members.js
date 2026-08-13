const crypto = require('crypto');
const { getRequestIdentity, getSupabaseAdmin, requireAdmin } = require('../server-supabase');
const store = require('../shared-store');
const { sendError, methodNotAllowed } = require('./_response');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const identity = await getRequestIdentity(req); requireAdmin(identity);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { const error = new Error('请输入有效邮箱'); error.status = 400; throw error; }
    const supabase = getSupabaseAdmin();
    let member;
    if (supabase) {
      const redirectTo = process.env.SITE_URL ? `${process.env.SITE_URL}/auth/callback` : undefined;
      const usersResult = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersResult.error) throw usersResult.error;
      let authUser = usersResult.data.users.find((item) => item.email?.trim().toLowerCase() === email);
      if (authUser) {
        const membership = await supabase.from('space_members').select('role,status,created_at').eq('space_id', identity.spaceId).eq('user_id', authUser.id).maybeSingle();
        if (membership.error) throw membership.error;
        if (membership.data) {
          const error = new Error(membership.data.status === 'active' ? '该邮箱已是空间成员' : '该邮箱已发送过邀请，正在等待对方加入');
          error.status = 409;
          error.existing = { id: authUser.id, email, role: membership.data.role, status: membership.data.status, createdAt: membership.data.created_at };
          throw error;
        }
        const login = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
        if (login.error) {
          if (login.error.status === 429) { const error = new Error('邮件发送过于频繁，请稍后再试'); error.status = 429; throw error; }
          throw login.error;
        }
      } else {
        const invite = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo, data: { invited_space_id: identity.spaceId } });
        if (invite.error) {
          if (invite.error.status === 429) {
            const error = new Error('邮件发送过于频繁，请稍后再试');
            error.status = 429;
            throw error;
          }
          throw invite.error;
        }
        authUser = invite.data.user;
      }
      const status = 'invited';
      member = { id: authUser.id, email, name: authUser.user_metadata?.name || email.split('@')[0], role: 'member', status };
      const profileResult = await supabase.from('profiles').upsert({ id: member.id, email, name: member.name });
      if (profileResult.error) throw profileResult.error;
      const membershipResult = await supabase.from('space_members').insert({ space_id: identity.spaceId, user_id: member.id, role: 'member', status, invited_by: identity.user.id }).select('created_at').single();
      if (membershipResult.error) {
        if (membershipResult.error.code === '23505') { const error = new Error('该邮箱已发送过邀请'); error.status = 409; throw error; }
        throw membershipResult.error;
      }
      member.createdAt = membershipResult.data.created_at;
    } else {
      const meta = await store.getMeta();
      const existing = (meta.members || []).find((item) => item.email?.trim().toLowerCase() === email);
      if (existing) { const error = new Error(existing.status === 'active' ? '该邮箱已是空间成员' : '该邮箱已发送过邀请'); error.status = 409; error.existing = existing; throw error; }
      member = { id: crypto.randomUUID(), email, name: email.split('@')[0], role: 'member', status: 'invited', createdAt: new Date().toISOString() }; meta.members = [...(meta.members || []), member]; await store.saveMeta(meta);
    }
    await store.addActivity(identity, 'member_invited', member.name);
    return res.status(201).json(member);
  } catch (error) { return sendError(res, error); }
};
