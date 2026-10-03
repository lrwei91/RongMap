const store = require('../shared-store');
const { getRequestIdentity } = require('../server-supabase');
const { inspectDay } = require('../roadbook');
const { sendError, methodNotAllowed } = require('./_response');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  res.setHeader('Cache-Control', 'no-store');
  try {
    const identity = await getRequestIdentity(req);
    const trip = await store.getTrip(identity, String(req.body?.tripId || ''));
    return res.status(200).json(await inspectDay(trip, Number(req.body?.dayIndex)));
  } catch (error) { return sendError(res, error); }
};
