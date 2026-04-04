/**
 * OpenClaw 地点录入接口
 * POST /api/openclaw/locations/intake
 *
 * 支持输入：
 * - text: 普通文本/地点名
 * - map_location: 地图定位信息
 * - douyin_url: 抖音 URL
 * - video: 视频附带文本/字幕/OCR
 */

const { processLocationIntake } = require('../../../lib/location-intake');

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

const OPENCLAW_SHARED_SECRET = process.env.OPENCLAW_SHARED_SECRET;

function verifyAuth(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  return token === OPENCLAW_SHARED_SECRET;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '方法不允许', allowed: 'POST' });
  }

  if (!verifyAuth(req)) {
    return res.status(401).json({ error: '未授权', code: 'UNAUTHORIZED' });
  }

  try {
    const result = await processLocationIntake(req.body || {}, storage);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[OpenClaw Intake] 错误:', err);
    return res.status(500).json({
      error: '服务器错误',
      message: err.message,
      code: 'INTERNAL_ERROR'
    });
  }
};
