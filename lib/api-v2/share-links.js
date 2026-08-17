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
      const scope = req.body?.scope === 'trip' ? 'trip' : 'space';
      const tripId = scope === 'trip' ? String(req.body?.tripId || '') : null;
      if (scope === 'trip' && !tripId) { const error = new Error('缺少行程编号'); error.status = 400; throw error; }
      const trip = tripId ? await store.getTrip(identity, tripId) : null;
      const token = crypto.randomBytes(24).toString('base64url');
      const link = { id: crypto.randomUUID(), label: String(req.body?.label || trip?.name || '亲友共享地图').trim().slice(0, 80), scope, tripId, createdAt: new Date().toISOString(), token };
      if (supabase) {
        const row = { id: link.id, space_id: identity.spaceId, label: link.label, token_hash: hashToken(token), scope, trip_id: tripId, created_by: identity.user.id, created_at: link.createdAt };
        let result = await supabase.from('share_links').insert(row);
        if (result.error?.code === '42703' && scope === 'space') {
          const legacyRow = { id: row.id, space_id: row.space_id, label: row.label, token_hash: row.token_hash, created_by: row.created_by, created_at: row.created_at };
          result = await supabase.from('share_links').insert(legacyRow);
        }
        if (result.error) throw result.error;
      } else { const meta = await store.getMeta(); meta.shareLinks = [link, ...(meta.shareLinks || [])]; await store.saveMeta(meta); }
      await store.addActivity(identity, scope === 'trip' ? 'trip_share_created' : 'share_created', link.label);
      return res.status(201).json(link);
    }
    if (req.method === 'DELETE') {
      const now = new Date().toISOString();
      let scope = 'space';
      if (supabase) {
        const found = await supabase.from('share_links').select('scope').eq('id', req.query.id).eq('space_id', identity.spaceId).maybeSingle();
        if (found.error && found.error.code !== '42703') throw found.error; scope = found.data?.scope || 'space';
        const result = await supabase.from('share_links').update({ revoked_at: now }).eq('id', req.query.id).eq('space_id', identity.spaceId); if (result.error) throw result.error;
      } else { const meta = await store.getMeta(); const link = (meta.shareLinks || []).find((item) => item.id === req.query.id); if (link) { link.revokedAt = now; scope = link.scope || 'space'; } await store.saveMeta(meta); }
      await store.addActivity(identity, scope === 'trip' ? 'trip_share_revoked' : 'share_revoked', '只读链接');
      return res.status(200).json({ success: true });
    }
    return methodNotAllowed(res, ['POST', 'DELETE']);
  } catch (error) { return sendError(res, error); }
};

module.exports.hashToken = hashToken;
