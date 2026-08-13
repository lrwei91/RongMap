const { buildLocationRecord } = require('../location-record');
const { isDuplicateLocation } = require('../location-duplicate');
const { getRequestIdentity } = require('../server-supabase');
const store = require('../shared-store');
const { sendError, methodNotAllowed } = require('./_response');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const identity = await getRequestIdentity(req);
    const records = req.body?.records;
    if (!Array.isArray(records) || records.length > 2000) { const error = new Error('单次最多导入2000条地点'); error.status = 400; throw error; }
    const current = (await store.bootstrap(identity)).locations;
    const result = { newCount: 0, duplicateCount: 0, conflictCount: 0, invalidCount: 0, items: [] };
    records.forEach((raw, index) => {
      if (!String(raw.name || raw.名称 || '').trim() || !String(raw.address || raw.地址 || '').trim()) { result.invalidCount += 1; result.items.push({ index, status: 'invalid' }); return; }
      const item = buildLocationRecord({ ...raw, name: raw.name || raw.名称, address: raw.address || raw.地址, sourceType: 'import' });
      const duplicate = isDuplicateLocation(item, current);
      if (!duplicate.isDuplicate) { result.newCount += 1; result.items.push({ index, status: 'new' }); return; }
      const addsValue = (!duplicate.existing.reason && item.reason) || (!duplicate.existing.latitude && item.latitude) || (raw.tags && raw.tags.length);
      if (addsValue) { result.conflictCount += 1; result.items.push({ index, status: 'conflict', existingId: duplicate.existing.id }); }
      else { result.duplicateCount += 1; result.items.push({ index, status: 'duplicate', existingId: duplicate.existing.id }); }
    });
    return res.status(200).json(result);
  } catch (error) { return sendError(res, error); }
};
