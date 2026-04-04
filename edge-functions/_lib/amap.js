const DEFAULT_CITY = '福州';
const FUZHOU_CITY_CODE = '0591';
const FUZHOU_ADCODE_PREFIX = '3501';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getAmapServerKey(env) {
  const key = normalizeText(env && env.AMAP_SERVER_KEY);

  if (!key) {
    throw new Error('未配置 AMAP_SERVER_KEY');
  }

  return key;
}

export function normalizePreferredCity(city) {
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

function buildUrl(path, params, env) {
  const query = new URLSearchParams({
    key: getAmapServerKey(env),
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

async function requestAmap(path, params, env) {
  const response = await fetch(buildUrl(path, params, env), {
    headers: {
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`高德请求失败：HTTP ${response.status}`);
  }

  let data;

  try {
    data = await response.json();
  } catch (err) {
    throw new Error('解析高德响应失败');
  }

  return data;
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

export async function searchPlaces({ keywords, city = DEFAULT_CITY, citylimit = false, offset = 20, page = 1 }, env) {
  const preferredCity = normalizePreferredCity(city);
  const firstResult = await requestAmap('/v3/place/text', {
    keywords,
    city: preferredCity,
    citylimit,
    offset,
    page,
    extensions: 'all'
  }, env);

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
  }, env);

  if (!Array.isArray(fallbackResult.pois)) {
    return fallbackResult;
  }

  return {
    ...fallbackResult,
    pois: sortPois(fallbackResult.pois, preferredCity)
  };
}

export async function geocodeAddress(address, env, city = DEFAULT_CITY) {
  const firstResult = await requestAmap('/v3/geocode/geo', {
    address,
    city: normalizePreferredCity(city)
  }, env);

  if (Array.isArray(firstResult.geocodes) && firstResult.geocodes.length > 0) {
    return firstResult;
  }

  return requestAmap('/v3/geocode/geo', { address }, env);
}

export async function reverseGeocode({ latitude, longitude, radius = 200 }, env) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('缺少有效坐标，无法逆地理编码');
  }

  return requestAmap('/v3/geocode/regeo', {
    location: `${lng},${lat}`,
    radius,
    extensions: 'all'
  }, env);
}

export {
  DEFAULT_CITY
};
