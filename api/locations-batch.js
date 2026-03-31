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
  if (req.method === 'POST') {
    const { locations: newLocations } = req.body;

    if (!Array.isArray(newLocations)) {
      return res.status(400).json({ error: '需要传入地点数组' });
    }

    const locations = await getLocations();
    const addedLocations = newLocations.map((loc, index) => ({
      id: Date.now().toString() + index,
      name: loc.name || '',
      address: loc.address || '',
      reason: loc.reason || null,
      latitude: loc.latitude || null,
      longitude: loc.longitude || null,
      createdAt: new Date().toISOString()
    }));

    locations.push(...addedLocations);
    await saveLocations(locations);

    return res.status(200).json({ added: addedLocations.length, locations: addedLocations });
  }

  return res.status(405).json({ error: '方法不允许' });
}
