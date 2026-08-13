const store = require('../../lib/shared-store');
const { getRequestIdentity } = require('../../lib/server-supabase');
const { getSupabaseAdmin } = require('../../lib/server-supabase');
const { sendError, methodNotAllowed } = require('./_response');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const identity = await getRequestIdentity(req);
    const { ids, action, value } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || ids.length > 500) { const error = new Error('请选择1到500个地点'); error.status = 400; throw error; }
    const supabase = getSupabaseAdmin();
    if (action === 'trash') {
      await Promise.all(ids.map((id) => store.softDelete(identity, id)));
    } else if (action === 'tag') {
      if (!value) { const error = new Error('请选择标签'); error.status = 400; throw error; }
      if (supabase) {
        await supabase.from('location_tags').upsert(ids.map((locationId) => ({ location_id: locationId, tag_id: value })), { onConflict: 'location_id,tag_id', ignoreDuplicates: true });
        await store.addActivity(identity, 'bulk_updated', `${ids.length} 个地点`, '批量添加标签');
      } else {
        const legacy = require('../../lib/locations-storage'); const list = await legacy.getLocations();
        list.forEach((item) => { if (ids.includes(String(item.id))) item.tags = [...new Set([...(item.tags || []), value])]; });
        await legacy.saveLocations(list); await store.addActivity(identity, 'bulk_updated', `${ids.length} 个地点`, '批量添加标签');
      }
    } else { const error = new Error('不支持的批量操作'); error.status = 400; throw error; }
    return res.status(200).json({ success: true, count: ids.length });
  } catch (error) { return sendError(res, error); }
};
