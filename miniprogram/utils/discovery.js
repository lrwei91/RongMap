/**
 * 发现小馆：把原 Web 端 lib/restaurant-discovery.js（服务端）与 lib/discovery.js（前端筛选）
 * 合并移植到小程序端。原版走自建服务端代理来藏高德 key；小程序没有自建服务，
 * 改为 wx.request 直连高德 REST，key 随之进客户端（同一把 Web 服务 key）。
 *
 * 行为与 Web 版保持一致：
 * - 只搜福州（bounds 越界直接报错），跨度大于 0.12° 拒绝搜索；
 * - 大区域按 0.025° 网格切 2x2 分格请求，避开高德单次返回上限；
 * - typecode 必须是 05（餐饮），0505/0506（咖啡厅/茶艺馆等）归为 cafe_bar；
 * - 结果按名称排序去重；同一边界 120 秒内直接复用缓存。
 */

// 原项目 .env 的 AMAP_WEB_SERVICE_KEY（Web 服务类型）。
// 客户端持有 key 有被盗用配额的风险：不要把它提交到公开仓库之外的地方，
// 若后续发现配额异常，去高德控制台重置 key 即可。
const AMAP_WEB_SERVICE_KEY = '8df650b9d87529c0d756660265fa82a2';
const AMAP_TIMEOUT_MS = 8000;

const DEFAULT_CITY = '福州';
const FUZHOU_CITY_CODE = '0591';
const FUZHOU_ADCODE_PREFIX = '3501';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value) {
  return typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
}

function buildUrl(path, params) {
  if (!AMAP_WEB_SERVICE_KEY) {
    throw new Error('高德 Web 服务密钥尚未配置');
  }
  const pairs = [['key', AMAP_WEB_SERVICE_KEY], ['output', 'json']];
  Object.keys(params || {}).forEach(function (key) {
    const value = params[key];
    if (value === undefined || value === null || value === '') return;
    pairs.push([key, String(value)]);
  });
  return 'https://restapi.amap.com' + path + '?' + pairs.map(function (pair) {
    return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]);
  }).join('&');
}

function requestAmap(path, params) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: buildUrl(path, params),
      method: 'GET',
      timeout: AMAP_TIMEOUT_MS,
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error('高德请求返回 HTTP ' + res.statusCode));
      },
      fail: function () {
        reject(new Error('高德请求失败，请检查网络'));
      }
    });
  });
}

function validateBounds(input) {
  const keys = ['west', 'south', 'east', 'north'];
  input = input || {};
  const missing = keys.some(function (key) {
    return typeof input[key] !== 'number' || !Number.isFinite(input[key]);
  });
  if (missing) {
    throw Object.assign(new Error('请等待地图加载后再搜索'), { status: 400 });
  }
  const west = input.west;
  const south = input.south;
  const east = input.east;
  const north = input.north;
  if (west >= east || south >= north || west < 118.2 || east > 120.7 || south < 25 || north > 27) {
    throw Object.assign(new Error('请将地图移到福州后搜索'), { status: 400 });
  }
  if (east - west > 0.12 || north - south > 0.12) {
    throw Object.assign(new Error('当前范围较大，请放大地图后搜索'), { status: 400 });
  }
  return { west: west, south: south, east: east, north: north };
}

function normalizeRestaurant(poi, bounds) {
  if (!text(poi.id) || !text(poi.name) || !text(poi.adcode).startsWith(FUZHOU_ADCODE_PREFIX) || !text(poi.typecode).startsWith('05')) return null;
  const parts = text(poi.location).split(',').map(Number);
  const longitude = parts[0];
  const latitude = parts[1];
  if (![longitude, latitude].every(Number.isFinite) || longitude < bounds.west || longitude > bounds.east || latitude < bounds.south || latitude > bounds.north) return null;
  const poiType = text(poi.type);
  const rating = number(poi.business && poi.business.rating);
  const cost = number(poi.business && poi.business.cost);
  return {
    id: 'discovery:' + poi.id,
    sourceId: poi.id,
    name: poi.name.slice(0, 120),
    address: [text(poi.cityname), text(poi.adname), text(poi.address)].filter(Boolean).join(''),
    city: text(poi.cityname) || '福州市',
    district: text(poi.adname),
    poiType: poiType,
    // 0505/0506 是咖啡厅与茶艺馆等「日咖夜酒」场景，其余归为餐馆小吃。
    category: /^050[56]/.test(poi.typecode) ? 'cafe_bar' : 'food',
    longitude: longitude,
    latitude: latitude,
    rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
    averageCost: cost !== null && cost > 0 ? cost : null
  };
}

const cache = new Map();
const CACHE_TTL_MS = 120000;
const CACHE_LIMIT = 128;

/**
 * 搜索 bounds 内的餐饮候选。request 参数仅供测试注入，运行时固定走 requestAmap。
 */
async function discoverRestaurants(boundsInput, query) {
  const request = query || requestAmap;
  const bounds = validateBounds(boundsInput);
  const key = JSON.stringify(bounds);
  const direct = request === requestAmap;
  const cached = direct && cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;

  // 大视野切成至多 2x2 个分格：高德单次返回上限会漏店，分格能把候选捞全。
  const columns = bounds.east - bounds.west > 0.025 ? 2 : 1;
  const rows = bounds.north - bounds.south > 0.025 ? 2 : 1;
  const results = [];
  let completed = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const left = bounds.west + (bounds.east - bounds.west) * x / columns;
      const right = bounds.west + (bounds.east - bounds.west) * (x + 1) / columns;
      const bottom = bounds.south + (bounds.north - bounds.south) * y / rows;
      const top = bounds.south + (bounds.north - bounds.south) * (y + 1) / rows;
      // 分格之间留 150ms 间隔，贴着原版对高德 QPS 的让步。
      if (completed || results.length) {
        await new Promise(function (resolve) { setTimeout(resolve, 150); });
      }
      try {
        const payload = await request('/v5/place/polygon', {
          polygon: left.toFixed(6) + ',' + top.toFixed(6) + '|' + right.toFixed(6) + ',' + bottom.toFixed(6),
          types: '050000',
          page_size: 25,
          page_num: 1,
          show_fields: 'business'
        });
        if (!payload || payload.status !== '1') continue;
        completed += 1;
        if (Array.isArray(payload.pois)) results.push.apply(results, payload.pois);
      } catch (error) {
        // 单格失败不中断：至少一格成功就返回部分结果。
      }
    }
  }
  if (!completed) {
    throw Object.assign(new Error('餐饮搜索暂时不可用，请稍后重试'), { status: 502 });
  }
  const seen = new Set();
  const restaurants = results.map(function (poi) { return normalizeRestaurant(poi, bounds); }).filter(function (item) {
    if (!item || seen.has(item.sourceId)) return false;
    seen.add(item.sourceId);
    return true;
  });
  restaurants.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-CN'); });
  const result = { restaurants: restaurants, bounds: bounds, fetchedAt: new Date().toISOString(), partial: completed < columns * rows };
  if (direct && !result.partial) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, result: result });
  }
  return result;
}

/** 候选 → 收藏地点的载荷：字段与 api.createLocation 的输入对齐。 */
function restaurantToLocation(item) {
  return {
    name: item.name,
    address: item.address,
    category: item.category,
    latitude: item.latitude,
    longitude: item.longitude,
    sourceId: item.sourceId,
    sourceType: 'manual',
    sourcePlatform: 'amap',
    matchType: 'manual_search',
    poiType: item.poiType,
    city: item.city,
    district: item.district,
    tags: [],
    reason: ''
  };
}

/** fetchedAt → 'HH:MM'（wxml 拿不到 toLocaleTimeString）。 */
function formatFetchedAt(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return hours + ':' + minutes;
}

module.exports = {
  discoverRestaurants,
  restaurantToLocation,
  validateBounds,
  normalizeRestaurant,
  formatFetchedAt,
  DEFAULT_CITY
};
