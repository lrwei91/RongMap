const https = require('https');
const { AMAP_WEB_SERVICE_KEY } = require('../lib/amap');

const STATIC_MAP_SIZE = '900*520';
const STATIC_MAP_ZOOM = 19;

function isFiniteCoordinate(value) {
  return Number.isFinite(Number(value));
}

function isValidCoordinatePair(latitude, longitude) {
  return isFiniteCoordinate(latitude) && isFiniteCoordinate(longitude) &&
    Number(latitude) >= -90 && Number(latitude) <= 90 &&
    Number(longitude) >= -180 && Number(longitude) <= 180;
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

  if (!isValidCoordinatePair(latitude, longitude)) {
    return res.status(400).json({ error: '缺少有效坐标' });
  }

  if (!AMAP_WEB_SERVICE_KEY) return res.status(503).json({ error: '地图服务尚未配置' });
  const url = buildStaticMapUrl({ latitude, longitude });

  const request = https.get(url, (response) => {
    if (response.statusCode !== 200) {
      response.resume();
      return res.status(502).json({ error: '高德静态地图请求失败' });
    }

    res.setHeader('Content-Type', response.headers['content-type'] || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    let size = 0;
    response.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        request.destroy(new Error('静态地图响应超过大小限制'));
        return;
      }
      res.write(chunk);
    });
    response.on('end', () => res.end());
  }).on('error', (err) => {
    console.error('share-map error:', err);
    if (!res.headersSent) return res.status(502).json({ error: '高德静态地图暂时不可用' });
    return res.end();
  });
  request.setTimeout(8000, () => request.destroy(new Error('静态地图请求超时')));
  return request;
};
