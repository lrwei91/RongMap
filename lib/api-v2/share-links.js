const crypto = require('crypto');
const { getRequestIdentity, getSupabaseAdmin, requireAdmin } = require('../server-supabase');
const store = require('../shared-store');
const { sendError, methodNotAllowed } = require('./_response');

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

module.exports = async function handler(req, res) {
  try {
    const identity = await getRequestIdentity(req); requireAdmin(identity);
    const supabase = getSupabaseAdmin();
    if (req.method === 'POST') {
      const token = crypto.randomBytes(24).toString('base64url');
      const link = { id: crypto.randomUUID(), label: String(req.body?.label || '亲友共享地图').trim().slice(0, 80), createdAt: new Date().toISOString(), token };
      if (supabase) {
        const row = { id: link.id, space_id: identity.spaceId, label: link.label, token_hash: hashToken(token), created_by: identity.user.id, created_at: link.createdAt };
        const result = await supabase.from('share_links').insert(row); if (result.error) throw result.error;
      } else { const meta = await store.getMeta(); meta.shareLinks = [link, ...(meta.shareLinks || [])]; await store.saveMeta(meta); }
      await store.addActivity(identity, 'share_created', link.label);
      return res.status(201).json(link);
    }
    if (req.method === 'DELETE') {
      const now = new Date().toISOString();
      if (supabase) { const result = await supabase.from('share_links').update({ revoked_at: now }).eq('id', req.query.id).eq('space_id', identity.spaceId); if (result.error) throw result.error; }
      else { const meta = await store.getMeta(); const link = (meta.shareLinks || []).find((item) => item.id === req.query.id); if (link) link.revokedAt = now; await store.saveMeta(meta); }
      await store.addActivity(identity, 'share_revoked', '只读链接');
      return res.status(200).json({ success: true });
    }
    return methodNotAllowed(res, ['POST', 'DELETE']);
  } catch (error) { return sendError(res, error); }
};

module.exports.hashToken = hashToken;
