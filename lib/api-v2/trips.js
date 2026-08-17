const store = require('../shared-store');
const { getRequestIdentity } = require('../server-supabase');
const { sendError, methodNotAllowed } = require('./_response');

module.exports = async function handler(req, res) {
  try {
    const identity = await getRequestIdentity(req);
    const id = String(req.query?.id || '');
    if (req.method === 'GET') {
      if (id) return res.status(200).json(await store.getTrip(identity, id));
      const data = await store.bootstrap(identity);
      return res.status(200).json({ items: data.trips || [], total: data.trips?.length || 0 });
    }
    if (req.method === 'POST') return res.status(201).json(await store.saveTrip(identity, null, req.body || {}));
    if (req.method === 'PUT') {
      if (!id) { const error = new Error('缺少行程编号'); error.status = 400; throw error; }
      if (req.body?.action === 'optimize') return res.status(200).json(await store.optimizeTrip(identity, id, req.body));
      return res.status(200).json(await store.saveTrip(identity, id, req.body || {}));
    }
    if (req.method === 'DELETE') {
      if (!id) { const error = new Error('缺少行程编号'); error.status = 400; throw error; }
      return res.status(200).json(await store.deleteTrip(identity, id));
    }
    return methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE']);
  } catch (error) { return sendError(res, error); }
};
