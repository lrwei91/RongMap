const https = require('https');
const { AMAP_WEB_SERVICE_KEY } = require('../lib/amap');

const STATIC_MAP_SIZE = '900*520';
const STATIC_MAP_ZOOM = 19;

function isFiniteCoordinate(value) {
  return Number.isFinite(Number(value));
}

function buildStaticMapUrl({ latitude, longitude }) {
  const lng = Number(longitude);
  const lat = Number(latitude);
  const query = new URLSearchParams({
    key: AMAP_WEB_SERVICE_KEY,
    location: `${lng},${lat}`,
    zoom: String(STATIC_MAP_ZOOM),
    size: STATIC_MAP_SIZE,
    scale: '2',
    traffic: '0',
    markers: `large,0xEF4444,A:${lng},${lat}`
  });

  return `https://restapi.amap.com/v3/staticmap?${query.toString()}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: '方法不允许' });
  }

  const { latitude, longitude } = req.query || {};

  if (!isFiniteCoordinate(latitude) || !isFiniteCoordinate(longitude)) {
    return res.status(400).json({ error: '缺少有效坐标' });
  }

  const url = buildStaticMapUrl({ latitude, longitude });

  return https.get(url, (response) => {
    if (response.statusCode !== 200) {
      response.resume();
      return res.status(502).json({ error: '高德静态地图请求失败' });
    }

    res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    response.pipe(res);
  }).on('error', (err) => {
    return res.status(500).json({ error: `高德静态地图请求失败：${err.message}` });
  });
};
