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
      let linkResult = await supabase.from('share_links').select('id,space_id,label,scope,trip_id,revoked_at,spaces(name)').eq('token_hash', hashToken(token)).is('revoked_at', null).maybeSingle();
      if (linkResult.error?.code === '42703') {
        linkResult = await supabase.from('share_links').select('id,space_id,label,revoked_at,spaces(name)').eq('token_hash', hashToken(token)).is('revoked_at', null).maybeSingle();
      }
      if (linkResult.error || !linkResult.data) { const error = new Error('共享链接已失效或被撤销'); error.status = 404; throw error; }
      if (linkResult.data.scope === 'trip' && linkResult.data.trip_id) {
        const identity = { spaceId: linkResult.data.space_id, user: { id: '', name: '只读访客' }, role: 'member' };
        const trip = await store.getTrip(identity, linkResult.data.trip_id);
        await supabase.from('share_links').update({ last_accessed_at: new Date().toISOString() }).eq('id', linkResult.data.id);
        return res.status(200).json({ type: 'trip', space: { id: linkResult.data.space_id, name: linkResult.data.spaces?.name || '共享空间' }, trip });
      }
      const locationResult = await supabase.from('locations').select('id,name,address,category,reason,latitude,longitude,created_at').eq('space_id', linkResult.data.space_id).is('deleted_at', null).order('created_at', { ascending: false }).limit(5000);
      if (locationResult.error) throw locationResult.error;
      await supabase.from('share_links').update({ last_accessed_at: new Date().toISOString() }).eq('id', linkResult.data.id);
      return res.status(200).json({ type: 'space', space: { id: linkResult.data.space_id, name: linkResult.data.spaces?.name || linkResult.data.label }, locations: locationResult.data.map(store.toCamel) });
    }
    const meta = await store.getMeta(); const link = (meta.shareLinks || []).find((item) => (item.token === token || item.id === token) && !item.revokedAt);
    if (!link) { const error = new Error('共享链接已失效或被撤销'); error.status = 404; throw error; }
    if (link.scope === 'trip' && link.tripId) {
      const trip = await store.getTrip({ spaceId: 'default', user: { id: '', name: '只读访客' }, role: 'member' }, link.tripId);
      return res.status(200).json({ type: 'trip', space: { id: 'default', name: '亲友共享地图' }, trip });
    }
    const legacy = require('../locations-storage'); const locations = (await legacy.getLocations()).filter((item) => !item.deletedAt);
    return res.status(200).json({ type: 'space', space: { id: 'default', name: link.label || '亲友共享地图' }, locations });
  } catch (error) { return sendError(res, error); }
};
