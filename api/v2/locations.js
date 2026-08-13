const store = require('../../lib/shared-store');
const { getRequestIdentity } = require('../../lib/server-supabase');
const { sendError, methodNotAllowed } = require('./_response');

function hasCoordinates(item) {
  return item.latitude !== null && item.latitude !== undefined && item.latitude !== '' &&
    item.longitude !== null && item.longitude !== undefined && item.longitude !== '' &&
    Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude));
}

module.exports = async function handler(req, res) {
  try {
    const identity = await getRequestIdentity(req);
    if (req.method === 'GET') {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
      const keyword = String(req.query.q || '').trim().toLowerCase();
      let items = (await store.bootstrap(identity)).locations.filter((item) => {
        if (keyword && ![item.name, item.address, item.reason, ...(item.tags || []).map((tag) => tag.name || tag)].join(' ').toLowerCase().includes(keyword)) return false;
        if (req.query.category && req.query.category !== 'all' && item.category !== req.query.category) return false;
        if (req.query.member && req.query.member !== 'all' && item.createdBy !== req.query.member) return false;
        if (req.query.source && req.query.source !== 'all' && item.sourceType !== req.query.source) return false;
        if (req.query.geocoded === 'yes' && !hasCoordinates(item)) return false;
        if (req.query.geocoded === 'no' && hasCoordinates(item)) return false;
        if (req.query.tag && req.query.tag !== 'all' && !(item.tags || []).some((tag) => (tag.id || tag) === req.query.tag)) return false;
        return true;
      });
      const sort = req.query.sort || 'created';
      items.sort((left, right) => sort === 'name' ? left.name.localeCompare(right.name, 'zh-CN') : new Date(sort === 'updated' ? right.updatedAt : right.createdAt) - new Date(sort === 'updated' ? left.updatedAt : left.createdAt));
      const total = items.length;
      items = items.slice((page - 1) * pageSize, page * pageSize);
      return res.status(200).json({ items, page, pageSize, total });
    }
    if (req.method === 'POST') return res.status(201).json(await store.createLocation(identity, req.body || {}));
    if (req.method === 'PUT') return res.status(200).json(await store.updateLocation(identity, req.query.id, req.body || {}));
    if (req.method === 'DELETE') return res.status(200).json(await store.softDelete(identity, req.query.id));
    return methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE']);
  } catch (error) { return sendError(res, error); }
};
