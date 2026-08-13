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
      const invite = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo, data: { invited_space_id: identity.spaceId } });
      if (invite.error) throw invite.error;
      member = { id: invite.data.user.id, email, name: email.split('@')[0], role: 'member', status: 'invited' };
      await supabase.from('profiles').upsert({ id: member.id, email, name: member.name });
      await supabase.from('space_members').upsert({ space_id: identity.spaceId, user_id: member.id, role: 'member', status: 'invited', invited_by: identity.user.id }, { onConflict: 'space_id,user_id' });
    } else {
      const meta = await store.getMeta(); member = { id: crypto.randomUUID(), email, name: email.split('@')[0], role: 'member', status: 'invited' }; meta.members = [...(meta.members || []), member]; await store.saveMeta(meta);
    }
    await store.addActivity(identity, 'member_invited', member.name);
    return res.status(201).json(member);
  } catch (error) { return sendError(res, error); }
};
