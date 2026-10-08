const { getDefaultMemberPassword, toMemberEmail } = require('./member-auth');

function conflict(message = '该用户名已被注册') {
  const error = new Error(message); error.status = 409; return error;
}

async function findAuthUser(supabase, email) {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage });
    if (result.error) throw result.error;
    const users = result.data.users;
    const user = users.find((item) => item.email?.trim().toLowerCase() === email);
    if (user) return user;
    if (!users.length || users.length < perPage) return null;
  }
}

async function registerSupabaseMember(supabase, identity, username, name) {
  const email = toMemberEmail(username);
  let user = await findAuthUser(supabase, email);
  if (!user) {
    const created = await supabase.auth.admin.createUser({
      email, password: getDefaultMemberPassword(), email_confirm: true,
      user_metadata: { name, username },
      // 服务端写入的恢复凭据；不能根据可由用户修改的 user_metadata 判定归属。
      app_metadata: { rongmap_registration_space: identity.spaceId }
    });
    if (created.error) {
      if (['email_exists', 'user_already_exists'].includes(created.error.code) || /already.*(?:registered|exists)/i.test(created.error.message || '')) {
        user = await findAuthUser(supabase, email);
        if (!user) throw conflict();
      } else if (created.error.status === 429) {
        const error = new Error('注册过于频繁，请稍后再试'); error.status = 429; throw error;
      } else throw created.error;
    } else user = created.data.user;
  }

  const memberships = await supabase.from('space_members').select('space_id,role,created_at').eq('user_id', user.id);
  if (memberships.error) throw memberships.error;
  if (memberships.data.some((item) => item.space_id !== identity.spaceId)) throw conflict();
  const existing = memberships.data.find((item) => item.space_id === identity.spaceId);
  if (existing) {
    const profile = await supabase.from('profiles').select('name,email').eq('id', user.id).single();
    if (profile.error) throw profile.error;
    return { member: { id: user.id, username, name: profile.data.name, email: profile.data.email, role: existing.role, status: 'active', createdAt: existing.created_at }, created: false };
  }
  if (user.app_metadata?.rongmap_registration_space !== identity.spaceId) {
    // 历史半成品账号缺少可信归属，不自动接管、重设密码或删除账号。
    throw conflict('该用户名的注册尚未完成，请联系管理员修复');
  }

  const profile = await supabase.from('profiles').upsert({ id: user.id, email, name }, { onConflict: 'id' }).select('name,email').single();
  if (profile.error) throw profile.error;
  // ignoreDuplicates 防止并发重试覆盖既有成员角色。
  const saved = await supabase.from('space_members').upsert({ space_id: identity.spaceId, user_id: user.id, role: 'member', invited_by: identity.user.id }, { onConflict: 'space_id,user_id', ignoreDuplicates: true });
  if (saved.error) throw saved.error;
  const membership = await supabase.from('space_members').select('role,created_at').eq('space_id', identity.spaceId).eq('user_id', user.id).single();
  if (membership.error) throw membership.error;
  return { member: { id: user.id, username, name: profile.data.name, email, role: membership.data.role, status: 'active', createdAt: membership.data.created_at }, created: true };
}

module.exports = { findAuthUser, registerSupabaseMember };
