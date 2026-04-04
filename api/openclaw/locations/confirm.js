/**
 * OpenClaw 地点确认接口
 * POST /api/openclaw/locations/confirm
 *
 * 用于多候选场景下的二次确认后落库
 */

// 自动检测环境：有 KV 配置用 KV，否则用本地文件
let storage;
if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
  try {
    storage = require('../../../lib/locations-storage');
    console.log('[Storage] 使用 Vercel KV');
  } catch (err) {
    storage = require('../../../lib/locations-storage-local');
    console.log('[Storage] 使用本地文件存储');
  }
} else {
  storage = require('../../../lib/locations-storage-local');
  console.log('[Storage] 使用本地文件存储（未配置 KV）');
}

const { createLocation } = storage;

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
    const { candidate, category, reason } = req.body;

    // 验证必填字段
    if (!candidate || typeof candidate !== 'object') {
      return res.status(400).json({ error: 'candidate 必填', code: 'MISSING_CANDIDATE' });
    }

    const {
      name,
      address,
      latitude,
      longitude,
      sourceType,
      sourcePlatform,
      sourceContent,
      confidence,
      matchType,
      poiType,
      city,
      district,
      createdBy,
      ruleDecision
    } = candidate;

    if (!name || !address) {
      return res.status(400).json({ error: '地点名称和地址不能为空', code: 'INVALID_CANDIDATE' });
    }

    console.log('[OpenClaw Confirm] 确认地点:', name, '地址:', address);

    // 创建地点
    const result = await createLocation({
      name,
      address,
      latitude: latitude || null,
      longitude: longitude || null,
      category: category || candidate.category || null,
      reason: reason || null,
      sourceType: sourceType || null,
      sourcePlatform: sourcePlatform || null,
      sourceContent: sourceContent || null,
      confidence: confidence || null,
      matchType: matchType || null,
      poiType: poiType || null,
      city: city || null,
      district: district || null,
      createdBy: createdBy || 'openclaw',
      ruleDecision: ruleDecision || 'manual_confirmation'
    });

    if (result.success) {
      console.log('[OpenClaw Confirm] 保存成功:', result.location.name);
      return res.status(200).json({
        status: 'saved',
        message: '地点已保存',
        location: result.location
      });
    } else if (result.status === 'duplicate') {
      console.log('[OpenClaw Confirm] 地点已存在:', name);
      return res.status(200).json({
        status: 'duplicate',
        message: '地点已存在',
        reason: result.reason,
        existing: result.existing
      });
    } else {
      return res.status(500).json({
        error: '保存失败',
        message: result.message || '未知错误',
        code: 'SAVE_FAILED'
      });
    }

  } catch (err) {
    console.error('[OpenClaw Confirm] 错误:', err);
    return res.status(500).json({
      error: '服务器错误',
      message: err.message,
      code: 'INTERNAL_ERROR'
    });
  }
};
