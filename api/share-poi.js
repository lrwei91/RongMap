const { requestAmap } = require('../lib/amap');

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isFiniteCoordinate(value) {
  return Number.isFinite(Number(value));
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
    console.error('share-poi error:', err);
    return res.status(502).json({ error: '高德地点详情暂时不可用' });
  }
};
