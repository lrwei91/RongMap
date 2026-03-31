const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, 'data', 'locations.json');

// 高德地图配置
const AMAP_CONFIG = {
  webServiceKey: '8df650b9d87529c0d756660265fa82a2'
};

// 中间件
app.use(express.json());
app.use(express.static('public'));

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

// API: 获取所有地点
app.get('/api/locations', (req, res) => {
  const locations = readData();
  res.json(locations);
});

// API: 添加地点
app.post('/api/locations', (req, res) => {
  const { name, address, latitude, longitude, reason } = req.body;

  if (!name || !address) {
    return res.status(400).json({ error: '名称和地址不能为空' });
  }

  const locations = readData();
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
  writeData(locations);

  res.json(newLocation);
});

// API: 批量添加地点
app.post('/api/locations/batch', (req, res) => {
  const { locations: newLocations } = req.body;

  if (!Array.isArray(newLocations)) {
    return res.status(400).json({ error: '需要传入地点数组' });
  }

  const locations = readData();
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
app.post('/api/geocode', (req, res) => {
  const { address } = req.body;

  if (!address) {
    return res.status(400).json({ error: '地址不能为空' });
  }

  const url = `https://restapi.amap.com/v3/geocode/geo?key=${AMAP_CONFIG.webServiceKey}&address=${encodeURIComponent(address)}&city=0591&output=json`;

  https.get(url, (response) => {
    let data = '';
    response.on('data', (chunk) => data += chunk);
    response.on('end', () => {
      try {
        const result = JSON.parse(data);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: '解析地理编码响应失败' });
      }
    });
  }).on('error', (err) => {
    res.status(500).json({ error: '地理编码请求失败：' + err.message });
  });
});

// API: 地点搜索（模糊搜索）
app.post('/api/search', (req, res) => {
  const { keywords, city } = req.body;

  if (!keywords) {
    return res.status(400).json({ error: '搜索关键词不能为空' });
  }

  const url = `https://restapi.amap.com/v3/place/text?key=${AMAP_CONFIG.webServiceKey}&keywords=${encodeURIComponent(keywords)}&city=${city || '0591'}&output=json`;

  https.get(url, (response) => {
    let data = '';
    response.on('data', (chunk) => data += chunk);
    response.on('end', () => {
      try {
        const result = JSON.parse(data);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: '解析搜索响应失败' });
      }
    });
  }).on('error', (err) => {
    res.status(500).json({ error: '搜索请求失败：' + err.message });
  });
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`福州地图应用已启动`);
});
