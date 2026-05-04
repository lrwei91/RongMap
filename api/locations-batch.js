const storage = require('../lib/locations-storage');
const { buildLocationRecord } = require('../lib/location-record');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { locations: newLocations } = req.body;

      if (!Array.isArray(newLocations)) {
        return res.status(400).json({ error: '需要传入地点数组' });
      }

      const locations = await storage.getLocations();
      const addedLocations = newLocations.map((loc, index) => buildLocationRecord({
        ...loc,
        sourceType: loc.sourceType || 'manual',
        sourcePlatform: loc.sourcePlatform || 'web',
        createdBy: loc.createdBy || 'user'
      }, {
        id: `${Date.now()}${index}`
      }));

      locations.push(...addedLocations);
      await storage.saveLocations(locations);

      return res.status(200).json({ added: addedLocations.length, locations: addedLocations });
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('handler error:', err);
    return res.status(500).json({ error: '服务器错误：' + err.message });
  }
};
