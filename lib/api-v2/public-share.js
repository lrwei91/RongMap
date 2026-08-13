const { getSupabaseAdmin } = require('../server-supabase');
const store = require('../shared-store');
const { hashToken } = require('./share-links');
const { sendError, methodNotAllowed } = require('./_response');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const token = String(req.query.token || '');
    if (!token) { const error = new Error('共享链接无效'); error.status = 404; throw error; }
    const supabase = getSupabaseAdmin();
    if (supabase) {
      const linkResult = await supabase.from('share_links').select('id,space_id,label,revoked_at,spaces(name)').eq('token_hash', hashToken(token)).is('revoked_at', null).maybeSingle();
      if (linkResult.error || !linkResult.data) { const error = new Error('共享链接已失效或被撤销'); error.status = 404; throw error; }
      const locationResult = await supabase.from('locations').select('id,name,address,category,reason,latitude,longitude,created_at').eq('space_id', linkResult.data.space_id).is('deleted_at', null).order('created_at', { ascending: false }).limit(5000);
      if (locationResult.error) throw locationResult.error;
      await supabase.from('share_links').update({ last_accessed_at: new Date().toISOString() }).eq('id', linkResult.data.id);
      return res.status(200).json({ space: { id: linkResult.data.space_id, name: linkResult.data.spaces?.name || linkResult.data.label }, locations: locationResult.data.map(store.toCamel) });
    }
    const meta = await store.getMeta(); const link = (meta.shareLinks || []).find((item) => (item.token === token || item.id === token) && !item.revokedAt);
    if (!link) { const error = new Error('共享链接已失效或被撤销'); error.status = 404; throw error; }
    const legacy = require('../locations-storage'); const locations = (await legacy.getLocations()).filter((item) => !item.deletedAt);
    return res.status(200).json({ space: { id: 'default', name: link.label || '亲友共享地图' }, locations });
  } catch (error) { return sendError(res, error); }
};
