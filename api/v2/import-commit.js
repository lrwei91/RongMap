const { getRequestIdentity } = require('../../lib/server-supabase');
const { isDuplicateLocation } = require('../../lib/location-duplicate');
const { buildLocationRecord } = require('../../lib/location-record');
const store = require('../../lib/shared-store');
const { sendError, methodNotAllowed } = require('./_response');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const identity = await getRequestIdentity(req);
    const records = req.body?.records;
    const policy = ['merge', 'skip', 'overwrite'].includes(req.body?.policy) ? req.body.policy : 'merge';
    if (!Array.isArray(records) || !records.length || records.length > 2000) { const error = new Error('请选择1到2000条地点'); error.status = 400; throw error; }
    let current = (await store.bootstrap(identity)).locations;
    const result = { created: 0, updated: 0, skipped: 0, invalid: 0 };
    for (const raw of records) {
      const input = { ...raw, name: raw.name || raw.名称, address: raw.address || raw.地址, reason: raw.reason || raw.备注 || '', category: raw.category || raw.分类 || 'food', latitude: raw.latitude || raw.纬度 || null, longitude: raw.longitude || raw.经度 || null, sourceType: 'import', tagIds: Array.isArray(raw.tagIds) ? raw.tagIds : [] };
      if (!String(input.name || '').trim() || !String(input.address || '').trim()) { result.invalid += 1; continue; }
      const duplicate = isDuplicateLocation(buildLocationRecord(input), current);
      if (!duplicate.isDuplicate) {
        const created = await store.createLocation(identity, input); current.push(created); result.created += 1; continue;
      }
      if (policy === 'skip') { result.skipped += 1; continue; }
      const merged = policy === 'merge' ? { ...duplicate.existing, reason: duplicate.existing.reason || input.reason, latitude: duplicate.existing.latitude || input.latitude, longitude: duplicate.existing.longitude || input.longitude, tagIds: [...new Set([...(duplicate.existing.tags || []).map((tag) => tag.id || tag), ...input.tagIds])], version: duplicate.existing.version } : { ...input, version: duplicate.existing.version };
      const updated = await store.updateLocation(identity, duplicate.existing.id, merged); current = current.map((item) => item.id === updated.id ? updated : item); result.updated += 1;
    }
    await store.addActivity(identity, 'import_committed', `${records.length} 条记录`, `新增${result.created}，更新${result.updated}，跳过${result.skipped}`);
    return res.status(200).json(result);
  } catch (error) { return sendError(res, error); }
};
