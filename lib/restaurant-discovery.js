const { requestAmap } = require('./amap');

const cache = new Map();
const text = (value) => typeof value === 'string' ? value.trim() : '';
const number = (value) => typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;

function validateBounds(input = {}) {
  const keys = ['west', 'south', 'east', 'north'];
  if (!input || !keys.every((key) => typeof input[key] === 'number' && Number.isFinite(input[key]))) {
    throw Object.assign(new Error('请等待地图加载后再搜索'), { status: 400 });
  }
  const { west, south, east, north } = input;
  if (west >= east || south >= north || west < 118.2 || east > 120.7 || south < 25 || north > 27) {
    throw Object.assign(new Error('请将地图移到福州后搜索'), { status: 400 });
  }
  if (east - west > 0.12 || north - south > 0.12) {
    throw Object.assign(new Error('当前范围较大，请放大地图后搜索'), { status: 400 });
  }
  return { west, south, east, north };
}

function normalizeRestaurant(poi, bounds) {
  if (!text(poi.id) || !text(poi.name) || !text(poi.adcode).startsWith('3501') || !text(poi.typecode).startsWith('05')) return null;
  const [longitude, latitude] = text(poi.location).split(',').map(Number);
  if (![longitude, latitude].every(Number.isFinite) || longitude < bounds.west || longitude > bounds.east || latitude < bounds.south || latitude > bounds.north) return null;
  const poiType = text(poi.type);
  const rating = number(poi.business?.rating);
  const cost = number(poi.business?.cost);
  return {
    id: `discovery:${poi.id}`, sourceId: poi.id, name: poi.name.slice(0, 120),
    address: [text(poi.cityname), text(poi.adname), text(poi.address)].filter(Boolean).join(''),
    city: text(poi.cityname) || '福州市', district: text(poi.adname), poiType,
    category: /^050[56]/.test(poi.typecode) ? 'cafe_bar' : 'food', longitude, latitude,
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    averageCost: cost !== null && cost > 0 ? cost : null
  };
}

async function discoverRestaurants(boundsInput, query = requestAmap) {
  const bounds = validateBounds(boundsInput);
  const key = JSON.stringify(bounds);
  const cached = query === requestAmap && cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const columns = bounds.east - bounds.west > 0.025 ? 2 : 1;
  const rows = bounds.north - bounds.south > 0.025 ? 2 : 1;
  const results = [];
  let completed = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const left = bounds.west + (bounds.east - bounds.west) * x / columns;
    const right = bounds.west + (bounds.east - bounds.west) * (x + 1) / columns;
    const bottom = bounds.south + (bounds.north - bounds.south) * y / rows;
    const top = bounds.south + (bounds.north - bounds.south) * (y + 1) / rows;
    if (completed || results.length) await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      const payload = await query('/v5/place/polygon', {
        polygon: `${left.toFixed(6)},${top.toFixed(6)}|${right.toFixed(6)},${bottom.toFixed(6)}`,
        types: '050000', page_size: 25, page_num: 1, show_fields: 'business'
      });
      if (payload.status !== '1') continue;
      completed++;
      results.push(...(Array.isArray(payload.pois) ? payload.pois : []));
    } catch { /* Return partial results only when at least one cell succeeded. */ }
  }
  if (!completed) throw Object.assign(new Error('餐饮搜索暂时不可用，请稍后重试'), { status: 502 });
  const seen = new Set();
  const restaurants = results.map((poi) => normalizeRestaurant(poi, bounds)).filter((item) => {
    if (!item || seen.has(item.sourceId)) return false;
    seen.add(item.sourceId);
    return true;
  });
  restaurants.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const result = { restaurants, bounds, fetchedAt: new Date().toISOString(), partial: completed < columns * rows };
  if (query === requestAmap && !result.partial) {
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, { expires: Date.now() + 120000, result });
  }
  return result;
}

module.exports = { discoverRestaurants, validateBounds, normalizeRestaurant };
