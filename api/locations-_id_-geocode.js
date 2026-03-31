const { kv } = require('@vercel/kv');

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
    if (req.method === 'PUT') {
      const { id } = req.query;
      const { latitude, longitude } = req.body;

      const locations = await getLocations();
      const location = locations.find(loc => loc.id === id);

      if (!location) {
        return res.status(404).json({ error: '未找到该地点' });
      }

      location.latitude = latitude;
      location.longitude = longitude;
      await saveLocations(locations);

      return res.status(200).json(location);
    }

    return res.status(405).json({ error: '方法不允许' });
  } catch (err) {
    console.error('handler error:', err);
    return res.status(500).json({ error: '服务器错误：' + err.message });
  }
};
