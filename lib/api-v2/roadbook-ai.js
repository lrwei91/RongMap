const store = require('../shared-store');
const { getRequestIdentity } = require('../server-supabase');
const { generatePlan } = require('../roadbook-ai');
const { methodNotAllowed } = require('./_response');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  res.setHeader('Cache-Control', 'no-store');
  try {
    const identity = await getRequestIdentity(req);
    const body = req.body || {};
    const trip = await store.getTrip(identity, String(body.tripId || ''));
    let locations;
    if (body.locationIds !== undefined) {
      if (!Array.isArray(body.locationIds) || !body.locationIds.length || body.locationIds.length > 60) throw Object.assign(new Error('请选择1到60个地点'), { status: 400 });
      const data = await store.bootstrap(identity);
      const ids = new Set(body.locationIds.map(String));
      locations = data.locations.filter((location) => ids.has(String(location.id)));
      if (locations.length !== ids.size) throw Object.assign(new Error('所选地点不存在或不属于当前空间'), { status: 403 });
    } else {
      locations = trip.days.flatMap((day) => day.items).map((item) => ({ ...item, id: item.locationId || item.id, isSnapshot: true }));
      locations = [...new Map(locations.map((item) => [item.id, item])).values()];
    }
    return res.status(200).json(await generatePlan(trip, locations, body));
  } catch (error) {
    // Provider exceptions can contain request headers: never log or return the raw exception.
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'AI规划暂时不可用' });
  }
};
