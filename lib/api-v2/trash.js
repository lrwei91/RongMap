const store = require('../shared-store');
const { getRequestIdentity, requireAdmin } = require('../server-supabase');
const { sendError, methodNotAllowed } = require('./_response');

module.exports = async function handler(req, res) {
  try {
    const identity = await getRequestIdentity(req);
    if (req.method === 'POST') return res.status(200).json(await store.restoreLocation(identity, req.body?.id));
    if (req.method === 'DELETE') { requireAdmin(identity); return res.status(200).json(await store.purgeLocation(identity, req.query.id)); }
    return methodNotAllowed(res, ['POST', 'DELETE']);
  } catch (error) { return sendError(res, error); }
};
