const http = require('http');
const https = require('https');

const { DEFAULT_CITY, normalizePreferredCity, reverseGeocode, searchPlaces } = require('./amap');
const { CATEGORY_DEFINITIONS, normalizeLocationCategory } = require('./location-category');
const { hasFiniteCoordinates, isFiniteCoordinateValue } = require('./location-coordinates');
const { normalizeText } = require('./location-record');

const CATEGORY_TYPE_RULES = {
  food: ['餐饮', '咖啡', '茶艺', '甜品', '小吃', '中餐', '西餐', '快餐', '蛋糕', '饮品'],
  spot: ['风景', '景点', '公园', '休闲', '娱乐', '博物馆', '寺庙', '古迹', '度假', '游乐', '文化'],
  shopping: ['购物', '商场', '超市', '市场', '便利店', '百货'],
  traffic: ['交通', '地铁', '火车', '汽车站', '机场', '码头', '公交'],
  medical: ['医疗', '医院', '诊所', '药店'],
  education: ['科教', '学校', '培训', '教育', '图书馆']
};

const CATEGORY_TEXT_RULES = {
  food: ['火锅', '烤肉', '小吃', '咖啡', '奶茶', '甜品', '餐厅', '饭店', '酒楼', '面馆', '烧烤'],
  spot: ['公园', '景区', '景点', '古镇', '乐园', '寺', '塔', '步道', '博物馆', '展览馆'],
  shopping: ['商场', '广场', '超市', '奥莱', '便利店', '购物'],
  traffic: ['机场', '火车站', '高铁站', '地铁站', '汽车站', '码头'],
  medical: ['医院', '诊所', '门诊', '药店'],
  education: ['大学', '学院', '学校', '幼儿园', '图书馆', '培训']
};

const LOCATION_HINTS = ['店', '路', '街', '巷', '广场', '公园', '景区', '景点', '地铁', '医院', '学校', '商场', '寺', '塔', '站', '咖啡', '火锅', '餐厅'];
const FILLER_TERMS = ['抖音', '视频', '链接', '点击', '打开看看', '复制此链接', '一起看看', '内容来自', '地图定位', '定位信息', '朋友说', '推荐', '很好吃', '值得去'];
const CONFIDENCE_ORDER = { high: 3, medium: 2, low: 1 };
const MAX_QUERY_COUNT = 4;
const MAX_POIS_PER_QUERY = 5;

function normalizeOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function truncateText(value, maxLength = 320) {
  const text = normalizeOptionalText(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function isLikelyUrl(value) {
  if (!value || typeof value !== 'string') return false;

  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (err) {
    return false;
  }
}

function decodeHtmlEntities(text) {
  return normalizeOptionalText(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(text) {
  return decodeHtmlEntities(normalizeOptionalText(text).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function getUniqueValues(values) {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const text = normalizeOptionalText(value);
    if (!text) return;

    const key = normalizeText(text);
    if (!key || seen.has(key)) return;

    seen.add(key);
    result.push(text);
  });

  return result;
}

function parseCoordinateText(text) {
  const coordRegexes = [
    /([1-9]\d{2}\.\d{4,})\s*[,，]\s*([1-9]?\d\.\d{4,})/,
    /(?:经度|lng|lon(?:gitude)?)\s*[:：]?\s*([1-9]\d{2}\.\d{4,})[\s,，;；]+(?:纬度|lat(?:itude)?)\s*[:：]?\s*([1-9]?\d\.\d{4,})/i,
    /(?:纬度|lat(?:itude)?)\s*[:：]?\s*([1-9]?\d\.\d{4,})[\s,，;；]+(?:经度|lng|lon(?:gitude)?)\s*[:：]?\s*([1-9]\d{2}\.\d{4,})/i
  ];

  for (const regex of coordRegexes) {
    const match = normalizeOptionalText(text).match(regex);
    if (!match) continue;

    const first = Number(match[1]);
    const second = Number(match[2]);

    if (first > 70) {
      return { longitude: first, latitude: second };
    }

    return { latitude: first, longitude: second };
  }

  return null;
}

function hasLocationHint(segment) {
  return LOCATION_HINTS.some((hint) => segment.includes(hint));
}

function cleanSegment(segment) {
  let next = normalizeOptionalText(segment)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[【】\[\]（）()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!next) return '';

  FILLER_TERMS.forEach((term) => {
    next = next.replace(new RegExp(term, 'gi'), ' ').replace(/\s+/g, ' ').trim();
  });

  return next.replace(/^[：:、，,。；;]+/, '').replace(/[：:、，,。；;]+$/, '').trim();
}

function scoreSegment(segment) {
  if (!segment) return 0;

  let score = 0;

  if (hasLocationHint(segment)) score += 50;
  if (segment.length >= 3 && segment.length <= 18) score += 25;
  if (/[\u4e00-\u9fa5]{2,}/.test(segment)) score += 15;
  if (/(?:路|街|巷|大道|广场|公园|景区|地铁站?|医院|学校|商场)/.test(segment)) score += 20;
  if (segment.length > 28) score -= 25;
  if (/^\d+$/.test(segment)) score -= 30;

  return score;
}

function extractQueriesFromText(text) {
  const cleaned = cleanSegment(text);
  if (!cleaned) return [];

  const candidateSegments = [];
  const hashtagMatches = cleaned.match(/#[^#\s]{2,24}/g) || [];
  const phraseMatches = cleaned.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,24}(?:店|路|街|巷|广场|公园|景区|景点|地铁站|医院|学校|商场|寺|塔|站|咖啡|火锅|餐厅)/g) || [];

  hashtagMatches.forEach((value) => candidateSegments.push(value.replace(/^#/, '')));
  phraseMatches.forEach((value) => candidateSegments.push(value));

  cleaned
    .split(/[\n\r，,。；;|]/)
    .map(cleanSegment)
    .filter(Boolean)
    .forEach((segment) => candidateSegments.push(segment));

  if (cleaned.length <= 28) {
    candidateSegments.push(cleaned);
  }

  return getUniqueValues(candidateSegments)
    .map((segment) => ({ segment, score: scoreSegment(segment) }))
    .filter((item) => item.score > 10)
    .filter((item) => item.segment.length <= 24 || hasLocationHint(item.segment))
    .sort((left, right) => right.score - left.score || left.segment.length - right.segment.length)
    .slice(0, MAX_QUERY_COUNT)
    .map((item) => item.segment);
}

function getCategoryFromRules(text, rules) {
  const normalized = normalizeOptionalText(text);
  if (!normalized) return null;

  for (const [category, keywords] of Object.entries(rules)) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return category;
    }
  }

  return null;
}

function inferCategory({ explicitCategory, poiType, name, address, sourceContent }) {
  const normalizedExplicitCategory = normalizeLocationCategory(explicitCategory, { fallback: null });
  if (normalizedExplicitCategory) {
    return normalizedExplicitCategory;
  }

  return normalizeLocationCategory(
    getCategoryFromRules(poiType, CATEGORY_TYPE_RULES)
    || getCategoryFromRules([name, address, sourceContent].filter(Boolean).join(' '), CATEGORY_TEXT_RULES)
    || 'other',
    { fallback: 'other' }
  );
}

function getCategoryAutoSaveMessage(category) {
  const label = CATEGORY_DEFINITIONS[category] && CATEGORY_DEFINITIONS[category].label;
  return label ? `${label}地点已自动保存` : '地点已自动保存';
}

function parsePoiLocation(location) {
  if (typeof location !== 'string') {
    return { longitude: null, latitude: null };
  }

  const [longitude, latitude] = location.split(',').map(Number);
  return {
    longitude: Number.isFinite(longitude) ? longitude : null,
    latitude: Number.isFinite(latitude) ? latitude : null
  };
}

function getDistanceMeters(left, right) {
  if (!left || !right) return null;

  const lat1 = Number(left.latitude);
  const lon1 = Number(left.longitude);
  const lat2 = Number(right.latitude);
  const lon2 = Number(right.longitude);

  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
    return null;
  }

  const earthRadius = 6371e3;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadius * c;
}

function scoreNameMatch(name, query) {
  const normalizedName = normalizeText(name);
  const normalizedQuery = normalizeText(query);

  if (!normalizedName || !normalizedQuery) return 0;
  if (normalizedName === normalizedQuery) return 55;
  if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) return 35;

  const overlap = normalizedQuery
    .split('')
    .filter((char) => normalizedName.includes(char)).length;

  if (overlap >= Math.max(2, Math.floor(normalizedQuery.length * 0.6))) {
    return 18;
  }

  return 0;
}

function evaluatePoiConfidence(poi, context = {}) {
  let score = 0;
  const queryCandidates = getUniqueValues([context.query, ...(context.queries || [])]);

  queryCandidates.forEach((query) => {
    score = Math.max(score, scoreNameMatch(poi.name, query));
  });

  if (normalizeOptionalText(poi.address).length >= 6) score += 10;
  if (normalizeOptionalText(poi.type)) score += 10;

  const { longitude, latitude } = parsePoiLocation(poi.location);
  if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
    score += 15;
  }

  if (context.preferredCity) {
    const cityValues = [poi.cityname, poi.adname, poi.pname].map(normalizeOptionalText).join(' ');
    if (cityValues.includes(context.preferredCity)) {
      score += 8;
    }
  }

  if (context.referenceCoordinates) {
    const distance = getDistanceMeters(
      { latitude, longitude },
      context.referenceCoordinates
    );

    if (distance !== null) {
      if (distance <= 80) score += 25;
      else if (distance <= 250) score += 15;
      else if (distance <= 800) score += 5;
    }
  }

  if (context.matchType === 'reverse_geocode') {
    score += 15;
  }

  if (score >= 75) return { level: 'high', score };
  if (score >= 45) return { level: 'medium', score };
  return { level: 'low', score };
}

function buildCandidateFromPoi(poi, context = {}) {
  const { longitude, latitude } = parsePoiLocation(poi.location);
  const category = inferCategory({
    explicitCategory: context.explicitCategory,
    poiType: poi.type,
    name: poi.name,
    address: poi.address,
    sourceContent: context.sourceContent
  });
  const confidence = evaluatePoiConfidence(poi, context);

  return {
    name: normalizeOptionalText(poi.name) || normalizeOptionalText(context.fallbackName),
    address: normalizeOptionalText(poi.address) || normalizeOptionalText(context.fallbackAddress),
    latitude,
    longitude,
    category,
    type: normalizeOptionalText(poi.type) || null,
    poiType: normalizeOptionalText(poi.type) || null,
    confidence: confidence.level,
    confidenceScore: confidence.score,
    matchType: context.matchType || 'search',
    sourceType: context.sourceType,
    sourcePlatform: context.sourcePlatform,
    sourceContent: context.sourceContent || null,
    city: normalizeOptionalText(poi.cityname) || context.preferredCity || null,
    district: normalizeOptionalText(poi.adname) || null,
    createdBy: context.createdBy || 'openclaw'
  };
}

function chooseSourcePlatform({ inputType, metadata, content }) {
  const explicitPlatform = normalizeOptionalText(metadata && metadata.platform);
  if (explicitPlatform) return explicitPlatform;
  if (inputType === 'douyin_url') return 'douyin';
  if (isLikelyUrl(content) && content.includes('douyin')) return 'douyin';
  if (inputType === 'map_location') return 'map';
  if (inputType === 'video') return 'video';
  return 'openclaw';
}

function summarizeSourceContent(parts) {
  const text = getUniqueValues(parts).join('\n');
  return truncateText(text, 400);
}

function getRequestCoordinates(locationPayload, metadata, texts) {
  const rawLatitude = locationPayload && locationPayload.latitude;
  const rawLongitude = locationPayload && locationPayload.longitude;

  if (isFiniteCoordinateValue(rawLatitude) && isFiniteCoordinateValue(rawLongitude)) {
    return { latitude: Number(rawLatitude), longitude: Number(rawLongitude) };
  }

  const merged = [metadata && metadata.coordinatesText, ...texts].filter(Boolean).join('\n');
  return parseCoordinateText(merged);
}

function createReverseGeocodeFallback(result, context) {
  const formattedAddress = normalizeOptionalText(result && result.regeocode && result.regeocode.formatted_address);
  const addressComponent = result && result.regeocode && result.regeocode.addressComponent;
  const district = normalizeOptionalText(addressComponent && addressComponent.district);
  const city = normalizeOptionalText(addressComponent && (addressComponent.city || addressComponent.province)) || context.preferredCity;

  if (!formattedAddress) {
    return null;
  }

  return {
    name: normalizeOptionalText(context.locationName) || district || '地图定位',
    address: formattedAddress,
    latitude: context.referenceCoordinates ? context.referenceCoordinates.latitude : null,
    longitude: context.referenceCoordinates ? context.referenceCoordinates.longitude : null,
    category: inferCategory({
      explicitCategory: context.explicitCategory,
      name: context.locationName,
      address: formattedAddress,
      sourceContent: context.sourceContent
    }),
    type: null,
    poiType: null,
    confidence: context.locationName ? 'medium' : 'low',
    confidenceScore: context.locationName ? 52 : 38,
    matchType: 'reverse_geocode',
    sourceType: context.sourceType,
    sourcePlatform: context.sourcePlatform,
    sourceContent: context.sourceContent || null,
    city: city || null,
    district: district || null,
    createdBy: context.createdBy || 'openclaw'
  };
}

function fetchRemoteText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('URL 重定向过多'));
      return;
    }

    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'http:' ? http : https;

    const request = client.request(parsedUrl, {
      method: 'GET',
      headers: {
        'user-agent': 'Mozilla/5.0 RongMapBot/1.0',
        accept: 'text/html,application/xhtml+xml'
      }
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const nextUrl = new URL(response.headers.location, parsedUrl).toString();
        resolve(fetchRemoteText(nextUrl, redirectCount + 1));
        return;
      }

      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({
          url: parsedUrl.toString(),
          body
        });
      });
    });

    request.on('error', (err) => reject(err));
    request.end();
  });
}

function extractDouyinText(html) {
  const title = normalizeOptionalText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const ogTitle = normalizeOptionalText((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1]);
  const description = normalizeOptionalText((html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1]);
  const ogDescription = normalizeOptionalText((html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1]);

  return getUniqueValues([
    stripHtml(title),
    stripHtml(ogTitle),
    stripHtml(description),
    stripHtml(ogDescription)
  ]);
}

async function collectIntakeContext(payload) {
  const rawInputType = normalizeOptionalText(payload.inputType);
  const query = normalizeOptionalText(payload.query);
  const content = normalizeOptionalText(payload.content);
  const locationPayload = payload.locationPayload && typeof payload.locationPayload === 'object' ? payload.locationPayload : {};
  const autoDetectedInputType = rawInputType
    || ((locationPayload.latitude !== undefined || locationPayload.longitude !== undefined) ? 'map_location' : '')
    || (isLikelyUrl(content) && content.includes('douyin') ? 'douyin_url' : '')
    || 'text';
  const inputType = autoDetectedInputType;
  const reason = normalizeOptionalText(payload.reason);
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const explicitCategory = normalizeOptionalText(payload.category);
  const locationName = normalizeOptionalText(locationPayload.name);
  const locationAddress = normalizeOptionalText(locationPayload.address);
  const preferredCity = normalizePreferredCity(payload.city || metadata.city || locationPayload.city || DEFAULT_CITY);
  const sourcePlatform = chooseSourcePlatform({ inputType, metadata, content });

  const contentParts = [
    query,
    content,
    metadata.title,
    metadata.caption,
    metadata.description,
    metadata.transcript,
    metadata.ocrText,
    locationName,
    locationAddress
  ];

  if (inputType === 'douyin_url' && isLikelyUrl(content)) {
    try {
      const fetched = await fetchRemoteText(content);
      extractDouyinText(fetched.body).forEach((value) => contentParts.push(value));
    } catch (err) {
      console.warn('[Location Intake] 抖音 URL 提取失败:', err.message);
    }
  }

  const sourceContent = summarizeSourceContent(contentParts);
  const textQueries = extractQueriesFromText(contentParts.join('\n'));
  const queries = getUniqueValues([query, locationName, locationAddress, ...textQueries]).slice(0, MAX_QUERY_COUNT);
  const referenceCoordinates = getRequestCoordinates(locationPayload, metadata, contentParts);

  return {
    inputType,
    query,
    queries,
    reason,
    explicitCategory: explicitCategory || null,
    preferredCity,
    sourceType: inputType,
    sourcePlatform,
    sourceContent: sourceContent || null,
    referenceCoordinates,
    locationName: locationName || null,
    locationAddress: locationAddress || null,
    createdBy: 'openclaw'
  };
}

async function collectCandidatesFromCoordinates(context) {
  if (!context.referenceCoordinates) {
    return [];
  }

  try {
    const reverseResult = await reverseGeocode(context.referenceCoordinates);
    const pois = Array.isArray(reverseResult && reverseResult.regeocode && reverseResult.regeocode.pois)
      ? reverseResult.regeocode.pois
      : [];

    const candidates = pois.slice(0, 3).map((poi) => buildCandidateFromPoi({
      ...poi,
      type: poi.type || null
    }, {
      ...context,
      matchType: 'reverse_geocode',
      query: context.locationName || context.locationAddress || context.query || ''
    }));

    if (candidates.length > 0) {
      return candidates;
    }

    const fallback = createReverseGeocodeFallback(reverseResult, context);
    return fallback ? [fallback] : [];
  } catch (err) {
    console.warn('[Location Intake] 逆地理编码失败:', err.message);
    return [];
  }
}

async function collectCandidatesFromQueries(context) {
  const candidates = [];

  for (const query of context.queries.slice(0, MAX_QUERY_COUNT)) {
    const searchResult = await searchPlaces({
      keywords: query,
      city: context.preferredCity,
      citylimit: false,
      offset: MAX_POIS_PER_QUERY,
      page: 1
    });

    const pois = Array.isArray(searchResult && searchResult.pois) ? searchResult.pois : [];
    pois.slice(0, MAX_POIS_PER_QUERY).forEach((poi) => {
      candidates.push(buildCandidateFromPoi(poi, {
        ...context,
        query,
        matchType: 'search'
      }));
    });
  }

  return candidates;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const result = [];

  candidates.forEach((candidate) => {
    const key = [
      normalizeText(candidate.name),
      normalizeText(candidate.address),
      isFiniteCoordinateValue(candidate.latitude) ? Number(candidate.latitude).toFixed(6) : '',
      isFiniteCoordinateValue(candidate.longitude) ? Number(candidate.longitude).toFixed(6) : ''
    ].join('::');

    if (seen.has(key)) return;
    seen.add(key);
    result.push(candidate);
  });

  return result;
}

function rankCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const confidenceDiff = (right.confidenceScore || 0) - (left.confidenceScore || 0);
    if (confidenceDiff !== 0) return confidenceDiff;

    const leftConfidence = CONFIDENCE_ORDER[left.confidence] || 0;
    const rightConfidence = CONFIDENCE_ORDER[right.confidence] || 0;
    if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;

    return normalizeOptionalText(left.name).length - normalizeOptionalText(right.name).length;
  });
}

function applyLocationRules(candidate, context) {
  const hasCoordinates = hasFiniteCoordinates(candidate);

  if (candidate.duplicateInfo && candidate.duplicateInfo.isDuplicate) {
    return {
      action: 'duplicate',
      ruleDecision: candidate.duplicateInfo.reason || 'duplicate_match',
      message: '地点已存在'
    };
  }

  if (!hasCoordinates) {
    return {
      action: 'needs_confirmation',
      ruleDecision: 'missing_coordinates',
      message: '地点缺少坐标，需要确认后再保存'
    };
  }

  if (context.candidateCount > 1) {
    return {
      action: 'needs_confirmation',
      ruleDecision: 'multiple_candidates',
      message: '高德找到多个匹配地点，请确认'
    };
  }

  if (candidate.category === 'food' || candidate.category === 'spot') {
    return {
      action: 'auto_save',
      ruleDecision: `${candidate.category}_auto_save`,
      message: getCategoryAutoSaveMessage(candidate.category)
    };
  }

  if (candidate.confidence === 'high') {
    return {
      action: 'auto_save',
      ruleDecision: 'high_confidence_auto_save',
      message: '高德找到高置信匹配，已自动保存'
    };
  }

  return {
    action: 'needs_confirmation',
    ruleDecision: 'manual_confirmation',
    message: '高德找到匹配地点，请确认'
  };
}

async function processLocationIntake(payload, storage) {
  const context = await collectIntakeContext(payload);

  if (!context.query && context.queries.length === 0 && !context.referenceCoordinates) {
    return {
      status: 'not_found',
      message: '未提供可识别的地点信息',
      sourceType: context.sourceType
    };
  }

  const [coordinateCandidates, queryCandidates, existingLocations] = await Promise.all([
    collectCandidatesFromCoordinates(context),
    collectCandidatesFromQueries(context),
    storage.getLocations()
  ]);

  const rankedCandidates = rankCandidates(dedupeCandidates([
    ...coordinateCandidates,
    ...queryCandidates
  ]).map((candidate) => ({
    ...candidate,
    duplicateInfo: storage.isDuplicateLocation(candidate, existingLocations)
  })));

  const nonDuplicateCandidates = rankedCandidates.filter((candidate) => !candidate.duplicateInfo.isDuplicate);
  const duplicateCandidates = rankedCandidates.filter((candidate) => candidate.duplicateInfo.isDuplicate);

  if (nonDuplicateCandidates.length === 0) {
    if (duplicateCandidates.length > 0) {
      const duplicate = duplicateCandidates[0];
      return {
        status: 'duplicate',
        message: '地点已存在',
        existing: duplicate.duplicateInfo.existing,
        reason: duplicate.duplicateInfo.reason,
        sourceType: context.sourceType
      };
    }

    return {
      status: 'not_found',
      message: '未找到相关地点',
      query: context.query || context.queries[0] || '',
      sourceType: context.sourceType
    };
  }

  const topCandidates = nonDuplicateCandidates.slice(0, 3);
  const primaryCandidate = topCandidates[0];
  const ruleResult = applyLocationRules(primaryCandidate, {
    candidateCount: nonDuplicateCandidates.length
  });

  if (ruleResult.action === 'auto_save') {
    const result = await storage.createLocation({
      ...primaryCandidate,
      reason: context.reason || null,
      category: primaryCandidate.category,
      ruleDecision: ruleResult.ruleDecision
    });

    if (result.success) {
      return {
        status: 'saved',
        message: ruleResult.message,
        ruleDecision: ruleResult.ruleDecision,
        location: result.location,
        sourceType: context.sourceType
      };
    }

    return {
      status: 'duplicate',
      message: '地点已存在',
      existing: result.existing,
      reason: result.reason,
      sourceType: context.sourceType
    };
  }

  return {
    status: 'needs_confirmation',
    message: ruleResult.message,
    ruleDecision: ruleResult.ruleDecision,
    query: context.query || context.queries[0] || '',
    sourceType: context.sourceType,
    candidates: topCandidates.map((candidate, index) => ({
      id: index + 1,
      name: candidate.name,
      address: candidate.address,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      category: candidate.category,
      type: candidate.type,
      poiType: candidate.poiType,
      confidence: candidate.confidence,
      matchType: candidate.matchType,
      sourceType: candidate.sourceType,
      sourcePlatform: candidate.sourcePlatform,
      sourceContent: candidate.sourceContent,
      city: candidate.city,
      district: candidate.district,
      createdBy: candidate.createdBy,
      ruleDecision: ruleResult.ruleDecision
    }))
  };
}

module.exports = {
  applyLocationRules,
  extractQueriesFromText,
  inferCategory,
  processLocationIntake
};
