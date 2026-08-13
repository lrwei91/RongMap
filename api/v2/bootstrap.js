const store = require('../../lib/shared-store');
const { getRequestIdentity } = require('../../lib/server-supabase');
const { sendError, methodNotAllowed } = require('./_response');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const identity = await getRequestIdentity(req);
    return res.status(200).json(await store.bootstrap(identity));
  } catch (error) { return sendError(res, error); }
};
