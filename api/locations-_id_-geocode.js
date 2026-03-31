import { kv } from '@vercel/kv';

const LOCATIONS_KEY = 'locations';

async function getLocations() {
  const data = await kv.get(LOCATIONS_KEY);
  return data ? JSON.parse(data) : [];
}

async function saveLocations(locations) {
  await kv.set(LOCATIONS_KEY, JSON.stringify(locations));
}

export default async function handler(req, res) {
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
}
