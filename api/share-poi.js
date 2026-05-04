const https = require('https');

const AMAP_WEB_SERVICE_KEY = '8df650b9d87529c0d756660265fa82a2';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isFiniteCoordinate(value) {
  return Number.isFinite(Number(value));
}

function buildAmapUrl(path, params) {
  const query = new URLSearchParams({
    key: AMAP_WEB_SERVICE_KEY,
    output: 'json'
  });

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });

  return `https://restapi.amap.com${path}?${query.toString()}`;
}

function requestAmap(path, params) {
  return new Promise((resolve, reject) => {
    https.get(buildAmapUrl(path, params), (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('解析高德响应失败'));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`高德请求失败：${err.message}`));
    });
  });
}

function firstPoi(result) {
  return Array.isArray(result && result.pois) ? result.pois[0] : null;
}

function normalizePoi(poi) {
  if (!poi) return null;
  const bizExt = poi.biz_ext && typeof poi.biz_ext === 'object' ? poi.biz_ext : {};

  return {
    id: normalizeText(poi.id),
    name: normalizeText(poi.name),
    address: normalizeText(poi.address),
    tel: normalizeText(poi.tel),
    type: normalizeText(poi.type),
    typecode: normalizeText(poi.typecode),
    businessArea: normalizeText(poi.business_area),
    openingHours: normalizeText(poi.opentime || poi.opentime2 || bizExt.open_time || bizExt.opentime),
    rating: normalizeText(bizExt.rating),
    cost: normalizeText(bizExt.cost),
    tag: normalizeText(poi.tag)
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: '方法不允许' });
  }

  const sourceId = normalizeText(req.query && req.query.sourceId);
  const name = normalizeText(req.query && req.query.name);
  const latitude = req.query && req.query.latitude;
  const longitude = req.query && req.query.longitude;

  try {
    if (sourceId) {
      const detail = await requestAmap('/v3/place/detail', {
        id: sourceId,
        extensions: 'all'
      });
      const poi = firstPoi(detail);
      if (poi) {
        return res.status(200).json({ poi: normalizePoi(poi), source: 'detail' });
      }
    }

    if (name && isFiniteCoordinate(latitude) && isFiniteCoordinate(longitude)) {
      const around = await requestAmap('/v3/place/around', {
        keywords: name,
        location: `${Number(longitude)},${Number(latitude)}`,
        radius: 1200,
        offset: 5,
        page: 1,
        extensions: 'all'
      });
      const poi = firstPoi(around);
      if (poi) {
        return res.status(200).json({ poi: normalizePoi(poi), source: 'around' });
      }
    }

    return res.status(200).json({ poi: null, source: 'none' });
  } catch (err) {
    return res.status(500).json({ error: err.message || '高德地点详情请求失败' });
  }
};
