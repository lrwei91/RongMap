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
    if (req.method === 'GET') {
      const locations = await getLocations();
      return res.status(200).json(locations);
    }

    if (req.method === 'POST') {
      const { name, address, latitude, longitude, reason, category } = req.body;

      if (!name || !address) {
        return res.status(400).json({ error: '名称和地址不能为空' });
      }

      const locations = await getLocations();
      const newLocation = {
        id: Date.now().toString(),
        name,
        address,
        reason: reason || null,
        category: category || null,
        latitude: latitude || null,
        longitude: longitude || null,
        createdAt: new Date().toISOString()
      };

      locations.push(newLocation);
      await saveLocations(locations);

      return res.status(200).json(newLocation);
    }

    if (req.method === 'PUT') {
      const { id } = req.query;
      const updates = req.body;

      const locations = await getLocations();
      const index = locations.findIndex(loc => loc.id === id);

      if (index === -1) {
        return res.status(404).json({ error: '未找到该地点' });
      }

      // 更新允许的字段
      const allowedFields = ['name', 'address', 'reason', 'category', 'latitude', 'longitude'];
      allowedFields.forEach(field => {
        if (updates[field] !== undefined) {
          locations[index][field] = updates[field];
        }
      });

      // 如果更新了地址但没有坐标，清除旧坐标
      if (updates.address && updates.address !== locations[index].address && !updates.latitude) {
        locations[index].latitude = null;
        locations[index].longitude = null;
      }

      await saveLocations(locations);
      return res.status(200).json(locations[index]);
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
  } catch (err) {
    console.error('handler error:', err);
    return res.status(500).json({ error: '服务器错误：' + err.message });
  }
};
