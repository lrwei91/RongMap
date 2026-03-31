const { kv } = require('@vercel/kv');

const LOCATIONS_KEY = 'locations';

async function getLocations() {
  const data = await kv.get(LOCATIONS_KEY);
  return data ? JSON.parse(data) : [];
}

async function saveLocations(locations) {
  await kv.set(LOCATIONS_KEY, JSON.stringify(locations));
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const locations = await getLocations();
    return res.status(200).json(locations);
  }

  if (req.method === 'POST') {
    const { name, address, latitude, longitude, reason } = req.body;

    if (!name || !address) {
      return res.status(400).json({ error: '名称和地址不能为空' });
    }

    const locations = await getLocations();
    const newLocation = {
      id: Date.now().toString(),
      name,
      address,
      reason: reason || null,
      latitude: latitude || null,
      longitude: longitude || null,
      createdAt: new Date().toISOString()
    };

    locations.push(newLocation);
    await saveLocations(locations);

    return res.status(200).json(newLocation);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const locations = await getLocations();
    const filtered = locations.filter(loc => loc.id !== id);

    if (filtered.length === locations.length) {
      return res.status(404).json({ error: '未找到该地点' });
    }

    await saveLocations(filtered);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: '方法不允许' });
};
