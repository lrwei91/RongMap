const https = require('https');
const { isFiniteCoordinateValue } = require('./location-coordinates');

const AMAP_WEB_SERVICE_KEY = process.env.AMAP_WEB_SERVICE_KEY || '';
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

function scorePoi(poi, preferredCity, index) {
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

  return score - (index * 0.001);
}

function sortPois(pois, preferredCity) {
  return pois
    .map((poi, index) => ({ poi, index }))
    .sort((a, b) => scorePoi(b.poi, preferredCity, b.index) - scorePoi(a.poi, preferredCity, a.index))
    .map((item) => item.poi);
}

async function searchPlaces({ keywords, city = DEFAULT_CITY, citylimit = false, offset = 20, page = 1 }) {
  const preferredCity = normalizePreferredCity(city);
  const firstResult = await requestAmap('/v3/place/text', {
    keywords,
    city: preferredCity,
    citylimit,
    offset,
    page,
    extensions: 'all'
  });

  if (Array.isArray(firstResult.pois) && firstResult.pois.length > 0) {
    return {
      ...firstResult,
      pois: sortPois(firstResult.pois, preferredCity)
    };
  }

  const fallbackResult = await requestAmap('/v3/place/text', {
    keywords,
    citylimit: false,
    offset,
    page,
    extensions: 'all'
  });

  if (!Array.isArray(fallbackResult.pois)) {
    return fallbackResult;
  }

  return {
    ...fallbackResult,
    pois: sortPois(fallbackResult.pois, preferredCity)
  };
}

async function reverseGeocode({ latitude, longitude, radius = 200 }) {
  if (!isFiniteCoordinateValue(latitude) || !isFiniteCoordinateValue(longitude)) {
    throw new Error('缺少有效坐标，无法逆地理编码');
  }

  return requestAmap('/v3/geocode/regeo', {
    location: `${Number(longitude)},${Number(latitude)}`,
    radius,
    extensions: 'all'
  });
}

module.exports = {
  AMAP_WEB_SERVICE_KEY,
  DEFAULT_CITY,
  normalizePreferredCity,
  requestAmap,
  reverseGeocode,
  searchPlaces
};
