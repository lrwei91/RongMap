/**
 * OpenClaw 地点录入接口
 * POST /api/openclaw/locations/intake
 *
 * 流程：
 * 1. 验证鉴权
 * 2. 搜索高德 POI
 * 3. 单个高置信结果 -> 自动写入
 * 4. 多结果 -> 返回候选供确认
 * 5. 无结果 -> 返回 not_found
 */

const { searchPlaces } = require('../../../lib/amap');

// 自动检测环境：有 KV 用 KV，否则用本地文件
let storage;
try {
  storage = require('../../../lib/locations-storage');
} catch (err) {
  storage = require('../../../lib/locations-storage-local');
}

const { getLocations, createLocation, normalizeText } = storage;

const OPENCLAW_SHARED_SECRET = process.env.OPENCLAW_SHARED_SECRET;

/**
 * 验证鉴权 Header
 */
function verifyAuth(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  return token === OPENCLAW_SHARED_SECRET;
}

/**
 * 评估 POI 置信度
 * 返回：high | medium | low
 */
function evaluatePoiConfidence(poi, keywords) {
  let score = 0;

  // 名称匹配度
  const poiName = normalizeText(poi.name);
  const searchKeywords = normalizeText(keywords);

  if (poiName === searchKeywords) {
    score += 50; // 完全匹配
  } else if (poiName.includes(searchKeywords) || searchKeywords.includes(poiName)) {
    score += 30; // 包含匹配
  } else if (poiName.split('').filter(c => searchKeywords.includes(c)).length >= searchKeywords.length * 0.6) {
    score += 15; // 字符相似度
  }

  // 是否有精确坐标
  if (poi.location && poi.location.split(',').length === 2) {
    score += 20;
  }

  // 地址完整性
  if (poi.address && poi.address.length > 10) {
    score += 15;
  }

  // POI 类型
  if (poi.type && poi.type.includes('购物') || poi.type.includes('餐饮') || poi.type.includes('公司企业')) {
    score += 10;
  }

  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * 格式化候选地点
 */
function formatCandidate(poi) {
  const [longitude, latitude] = poi.location ? poi.location.split(',').map(Number) : [null, null];

  return {
    name: poi.name,
    address: poi.address,
    latitude: latitude,
    longitude: longitude,
    type: poi.type || null,
    confidence: evaluatePoiConfidence(poi, poi.name)
  };
}

module.exports = async function handler(req, res) {
  // 仅允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许', allowed: 'POST' });
  }

  // 验证鉴权
  if (!verifyAuth(req)) {
    return res.status(401).json({ error: '未授权', code: 'UNAUTHORIZED' });
  }

  try {
    const { query, category, reason, city } = req.body;

    // 验证必填字段
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: 'query 必填', code: 'MISSING_QUERY' });
    }

    const searchQuery = query.trim();
    const searchCity = city || '福州';

    console.log('[OpenClaw Intake] 搜索地点:', searchQuery, '城市:', searchCity);

    // 搜索高德 POI
    const searchResult = await searchPlaces({
      keywords: searchQuery,
      city: searchCity,
      citylimit: false,
      offset: 10,
      page: 1
    });

    if (!searchResult || !searchResult.pois || searchResult.pois.length === 0) {
      return res.status(200).json({
        status: 'not_found',
        message: '未找到相关地点',
        query: searchQuery
      });
    }

    const pois = searchResult.pois;

    // 评估每个 POI 的置信度
    const candidates = pois
      .map(poi => ({ ...poi, confidence: evaluatePoiConfidence(poi, searchQuery) }))
      .filter(poi => poi.confidence !== 'low');

    if (candidates.length === 0) {
      return res.status(200).json({
        status: 'not_found',
        message: '未找到高置信度地点',
        query: searchQuery
      });
    }

    // 检查已有地点（去重）
    const existingLocations = await getLocations();
    const nonDuplicateCandidates = [];

    for (const candidate of candidates) {
      const formatted = formatCandidate(candidate);
      const duplicateCheck = await createLocation({
        name: formatted.name,
        address: formatted.address,
        latitude: formatted.latitude,
        longitude: formatted.longitude
      });

      if (duplicateCheck.status === 'duplicate') {
        // 已存在，记录但不返回错误
        console.log('[OpenClaw Intake] 地点已存在:', formatted.name);
      } else {
        nonDuplicateCandidates.push(formatted);
      }
    }

    // 只有一个高置信候选 -> 自动保存
    if (nonDuplicateCandidates.length === 1 && nonDuplicateCandidates[0].confidence === 'high') {
      const result = await createLocation(nonDuplicateCandidates[0]);

      if (result.success) {
        console.log('[OpenClaw Intake] 自动保存地点:', result.location.name);
        return res.status(200).json({
          status: 'saved',
          message: '地点已自动保存',
          location: result.location,
          category: category || null,
          reason: reason || null
        });
      } else if (result.status === 'duplicate') {
        return res.status(200).json({
          status: 'duplicate',
          message: '地点已存在',
          existing: result.existing
        });
      }
    }

    // 多个候选 -> 返回供确认（最多 3 个）
    const topCandidates = nonDuplicateCandidates
      .sort((a, b) => {
        const confidenceOrder = { high: 3, medium: 2, low: 1 };
        return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
      })
      .slice(0, 3)
      .map((c, i) => ({
        id: i + 1,
        name: c.name,
        address: c.address,
        latitude: c.latitude,
        longitude: c.longitude,
        type: c.type,
        confidence: c.confidence
      }));

    console.log('[OpenClaw Intake] 返回候选数量:', topCandidates.length);

    return res.status(200).json({
      status: 'needs_confirmation',
      message: '找到多个候选地点，请确认',
      query: searchQuery,
      candidates: topCandidates,
      category: category || null,
      reason: reason || null
    });

  } catch (err) {
    console.error('[OpenClaw Intake] 错误:', err);
    return res.status(500).json({
      error: '服务器错误',
      message: err.message,
      code: 'INTERNAL_ERROR'
    });
  }
};
