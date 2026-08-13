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

const { processLocationIntake } = require('../location-intake');
const storage = require('../openclaw-shared-storage');
const { verifyBearerSecret } = require('../request-auth');

function verifyAuth(req) {
  return verifyBearerSecret(req, process.env.OPENCLAW_SHARED_SECRET);
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
      code: 'INTERNAL_ERROR'
    });
  }
};
