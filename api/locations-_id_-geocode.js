const storage = require('../lib/locations-storage');
const { applyLocationUpdates } = require('../lib/location-record');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'PUT') {
      const { id } = req.query;
      const { latitude, longitude } = req.body;

      const locations = await storage.getLocations();
      const location = locations.find(loc => loc.id === id);

      if (!location) {
        return res.status(404).json({ error: '未找到该地点' });
      }

      const index = locations.findIndex(loc => loc.id === id);
      locations[index] = applyLocationUpdates(location, { latitude, longitude });
      await storage.saveLocations(locations);

      return res.status(200).json(locations[index]);
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('handler error:', err);
    return res.status(500).json({ error: '服务器错误：' + err.message });
  }
};
