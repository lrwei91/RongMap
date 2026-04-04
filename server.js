// 加载环境变量（本地开发用）
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });

const express = require('express');
const fs = require('fs');
const { DEFAULT_CITY, geocodeAddress, normalizePreferredCity, searchPlaces } = require('./lib/amap');
const { applyLocationUpdates, buildLocationRecord } = require('./lib/location-record');

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, 'data', 'locations.json');

// 中间件
app.use(express.json());
app.use(express.static('public'));

// OpenClaw API 路由
app.use('/api/openclaw/locations/intake', require('./api/openclaw/locations/intake'));
app.use('/api/openclaw/locations/confirm', require('./api/openclaw/locations/confirm'));

// 读取数据
function readData() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// 写入数据
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getLocationId(req) {
  return req.params.id || req.query.id;
}

// API: 获取所有地点
app.get('/api/locations', (req, res) => {
  const locations = readData();
  res.json(locations);
});

// API: 添加地点
app.post('/api/locations', (req, res) => {
  const { name, address } = req.body;

  if (!name || !address) {
    return res.status(400).json({ error: '名称和地址不能为空' });
  }

  const locations = readData();
  const newLocation = buildLocationRecord({
    ...req.body,
    sourceType: req.body.sourceType || 'manual',
    sourcePlatform: req.body.sourcePlatform || 'web',
    createdBy: req.body.createdBy || 'user'
  });

  locations.push(newLocation);
  writeData(locations);

  res.json(newLocation);
});

// API: 更新地点
app.put('/api/locations', (req, res) => {
  const id = getLocationId(req);
  const updates = req.body;

  if (!id) {
    return res.status(400).json({ error: '缺少地点 ID' });
  }

  const locations = readData();
  const index = locations.findIndex(loc => loc.id === id);

  if (index === -1) {
    return res.status(404).json({ error: '未找到该地点' });
  }

  locations[index] = applyLocationUpdates(locations[index], updates);

  writeData(locations);
  res.json(locations[index]);
});

// API: 批量添加地点
app.post('/api/locations/batch', (req, res) => {
  const { locations: newLocations } = req.body;

  if (!Array.isArray(newLocations)) {
    return res.status(400).json({ error: '需要传入地点数组' });
  }

  const locations = readData();
  const addedLocations = newLocations.map((loc, index) => ({
    ...buildLocationRecord({
      ...loc,
      sourceType: loc.sourceType || 'manual',
      sourcePlatform: loc.sourcePlatform || 'web',
      createdBy: loc.createdBy || 'user'
    }, {
      id: `${Date.now()}${index}`
    })
  }));

  locations.push(...addedLocations);
  writeData(locations);

  res.json({ added: addedLocations.length, locations: addedLocations });
});

// API: 删除地点
app.delete('/api/locations/:id', (req, res) => {
  const { id } = req.params;
  const locations = readData();
  const filtered = locations.filter(loc => loc.id !== id);

  if (filtered.length === locations.length) {
    return res.status(404).json({ error: '未找到该地点' });
  }

  writeData(filtered);
  res.json({ success: true });
});

app.delete('/api/locations', (req, res) => {
  const id = getLocationId(req);

  if (!id) {
    return res.status(400).json({ error: '缺少地点 ID' });
  }

  const locations = readData();
  const filtered = locations.filter(loc => loc.id !== id);

  if (filtered.length === locations.length) {
    return res.status(404).json({ error: '未找到该地点' });
  }

  writeData(filtered);
  res.json({ success: true });
});

// API: 更新地点的经纬度
app.put('/api/locations/:id/geocode', (req, res) => {
  const { id } = req.params;
  const { latitude, longitude } = req.body;

  const locations = readData();
  const location = locations.find(loc => loc.id === id);

  if (!location) {
    return res.status(404).json({ error: '未找到该地点' });
  }

  location.latitude = latitude;
  location.longitude = longitude;
  writeData(locations);

  res.json(location);
});

// API: 地理编码
app.post('/api/geocode', async (req, res) => {
  const { address } = req.body;

  if (!address) {
    return res.status(400).json({ error: '地址不能为空' });
  }

  try {
    const result = await geocodeAddress(address);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || '地理编码请求失败' });
  }
});

// API: 地点搜索（模糊搜索）
app.post('/api/search', async (req, res) => {
  const { keywords, city } = req.body;

  if (!keywords) {
    return res.status(400).json({ error: '搜索关键词不能为空' });
  }

  try {
    const result = await searchPlaces({
      keywords,
      city: normalizePreferredCity(city || DEFAULT_CITY)
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || '搜索请求失败' });
  }
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`福州地图应用已启动`);
});
