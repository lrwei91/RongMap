const { kv } = require('@vercel/kv');
const { buildLocationRecord } = require('../lib/location-record');

const LOCATIONS_KEY = 'locations';

async function getLocations() {
  try {
    const data = await kv.get(LOCATIONS_KEY);
    return data || [];
  } catch (err) {
    console.error('getLocations error:', err.message);
    throw err;
  }
}

async function saveLocations(locations) {
  try {
    await kv.set(LOCATIONS_KEY, locations);
  } catch (err) {
    console.error('saveLocations error:', err.message);
    throw err;
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { locations: newLocations } = req.body;

      if (!Array.isArray(newLocations)) {
        return res.status(400).json({ error: '需要传入地点数组' });
      }

      const locations = await getLocations();
      const addedLocations = newLocations.map((loc, index) => buildLocationRecord({
        ...loc,
        sourceType: loc.sourceType || 'manual',
        sourcePlatform: loc.sourcePlatform || 'web',
        createdBy: loc.createdBy || 'user'
      }, {
        id: `${Date.now()}${index}`
      }));

      locations.push(...addedLocations);
      await saveLocations(locations);

      return res.status(200).json({ added: addedLocations.length, locations: addedLocations });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('handler error:', err);
    return res.status(500).json({ error: '服务器错误：' + err.message });
  }
};
