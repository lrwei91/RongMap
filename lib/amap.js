const https = require('https');


const AMAP_WEB_SERVICE_KEY = process.env.AMAP_WEB_SERVICE_KEY;
const AMAP_TIMEOUT_MS = 8000;
const AMAP_MAX_RESPONSE_BYTES = 1024 * 1024;

const DEFAULT_CITY = '福州';
const FUZHOU_CITY_CODE = '0591';
const FUZHOU_ADCODE_PREFIX = '3501';

function normalizePreferredCity(city) {
  if (typeof city !== 'string') {
    return DEFAULT_CITY;
  }

  const trimmed = city.trim();

  if (!trimmed) {
    return DEFAULT_CITY;
  }

  if (trimmed === DEFAULT_CITY || trimmed === `${DEFAULT_CITY}市` || trimmed === FUZHOU_CITY_CODE || trimmed === '350100') {
    return DEFAULT_CITY;
  }

  return trimmed.replace(/市$/, '');
}

function buildUrl(path, params) {
  if (!AMAP_WEB_SERVICE_KEY) {
    throw new Error('高德 Web 服务密钥尚未配置');
  }
  const query = new URLSearchParams({
    key: AMAP_WEB_SERVICE_KEY,
    output: 'json'
  });

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    query.set(key, String(value));
  });

  return `https://restapi.amap.com${path}?${query.toString()}`;
}

function requestAmap(path, params) {
  return new Promise((resolve, reject) => {
    const request = https.get(buildUrl(path, params), (response) => {
      let data = '';
      let size = 0;

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`高德请求返回 HTTP ${response.statusCode}`));
        return;
      }

      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > AMAP_MAX_RESPONSE_BYTES) {
          request.destroy(new Error('高德响应超过大小限制'));
          return;
        }
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
    request.setTimeout(AMAP_TIMEOUT_MS, () => request.destroy(new Error('高德请求超时')));
  });
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isFuzhouPoi(poi) {
  const citycode = normalizeText(poi && poi.citycode);
  const adcode = normalizeText(poi && poi.adcode);
  const cityname = normalizeText(poi && poi.cityname);
  const pname = normalizeText(poi && poi.pname);
  const adname = normalizeText(poi && poi.adname);

  return citycode === FUZHOU_CITY_CODE ||
    adcode.startsWith(FUZHOU_ADCODE_PREFIX) ||
    cityname.includes(DEFAULT_CITY) ||
    pname.includes(DEFAULT_CITY) ||
    adname.includes(DEFAULT_CITY);
}

function scorePoi(poi, preferredCity, index, keywords = '') {
  const city = normalizePreferredCity(preferredCity);
  const cityname = normalizeText(poi && poi.cityname);
  const pname = normalizeText(poi && poi.pname);
  const adname = normalizeText(poi && poi.adname);
  let score = 0;

  if (city && (
    cityname.includes(city) ||
    pname.includes(city) ||
    adname.includes(city)
  )) {
    score += 100;
  }

  if (city === DEFAULT_CITY && isFuzhouPoi(poi)) {
    score += 80;
  }

  if (normalizeText(poi && poi.location)) {
    score += 10;
  }

  const name = normalizeText(poi && poi.name).replace(/\s/g, '').toLowerCase();
  const keyword = normalizeText(keywords).replace(/\s/g, '').toLowerCase();
  if (keyword && name === keyword) score += 60;
  else if (keyword && name.includes(keyword)) score += 30;

  return score - (index * 0.001);
}

function sortPois(pois, preferredCity, keywords) {
  return pois
    .map((poi, index) => ({ poi, index }))
    .sort((a, b) => scorePoi(b.poi, preferredCity, b.index, keywords) - scorePoi(a.poi, preferredCity, a.index, keywords))
    .map((item) => item.poi);
}

// 输入提示能召回部分关键词搜索遗漏的店铺；过滤公交线路和无坐标的提示。
function tipToPoi(tip, preferredCity) {
  if (!tip || typeof tip !== 'object') return null;
  const location = normalizeText(tip.location);
  const parts = location.split(',');
  const [longitude, latitude] = parts.map(Number);
  if (!normalizeText(tip.id) || !normalizeText(tip.name) || parts.length !== 2 ||
      parts.some((part) => !part.trim()) || !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  const district = normalizeText(tip.district);
  const cityname = district.match(/([^省]+市)/)?.[1] || normalizePreferredCity(preferredCity) + '市';
  return {
    ...tip, location, cityname,
    adname: district.includes(cityname) ? district.split(cityname).pop() : district,
    address: normalizeText(tip.address), type: normalizeText(tip.type)
  };
}

async function searchPlaces({ keywords, city = DEFAULT_CITY, citylimit = false, offset = 20, page = 1 }, query = requestAmap) {
  const keyword = normalizeText(keywords);
  if (!keyword || keyword.length > 80) {
    throw Object.assign(new Error('请输入 1–80 字的搜索关键词'), { status: 400 });
  }
  const preferredCity = normalizePreferredCity(city);
  const responses = await Promise.allSettled([
    query('/v3/place/text', { keywords: keyword, city: preferredCity, citylimit, offset, page, extensions: 'all' }),
    query('/v3/assistant/inputtips', { keywords: keyword, city: preferredCity, citylimit: true, datatype: 'poi' })
  ]);
  const payloads = responses.map((response) => response.status === 'fulfilled' && response.value?.status === '1' ? response.value : null);
  const [textResult, tipsResult] = payloads;
  const candidates = [
    ...(Array.isArray(textResult?.pois) ? textResult.pois : []),
    ...(Array.isArray(tipsResult?.tips) ? tipsResult.tips.map((tip) => tipToPoi(tip, preferredCity)).filter(Boolean) : [])
  ];
  const seen = new Set();
  const pois = sortPois(candidates.filter((poi) => {
    const key = normalizeText(poi.id) || `${normalizeText(poi.name)}:${normalizeText(poi.location)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }), preferredCity, keyword);
  if (pois.length) return { status: '1', info: 'OK', count: String(pois.length), pois, partial: payloads.some((payload) => !payload) };
  // 配额、权限或网络故障不能伪装成没有匹配结果。
  if (payloads.some((payload) => !payload)) {
    throw Object.assign(new Error('搜索服务暂时不可用'), { status: 502 });
  }
  const fallbackResult = await query('/v3/place/text', {
    keywords: keyword, citylimit: false, offset, page, extensions: 'all'
  });
  if (fallbackResult.status !== '1') throw Object.assign(new Error('搜索服务暂时不可用'), { status: 502 });
  return { ...fallbackResult, pois: sortPois(Array.isArray(fallbackResult.pois) ? fallbackResult.pois : [], preferredCity, keyword) };
}

module.exports = {
  AMAP_WEB_SERVICE_KEY,
  DEFAULT_CITY,
  normalizePreferredCity,
  requestAmap,
  searchPlaces
};
