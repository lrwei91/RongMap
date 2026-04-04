import { createLocation } from '../../../_lib/storage.js';
import { getBearerToken, json, methodNotAllowed, parseJsonRequest, unauthorized } from '../../../_lib/http.js';

function verifyAuth(request, env) {
  const token = getBearerToken(request);
  return Boolean(token) && token === env.OPENCLAW_SHARED_SECRET;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return methodNotAllowed('POST');
  }

  if (!verifyAuth(request, env)) {
    return unauthorized({ code: 'UNAUTHORIZED' });
  }

  try {
    const body = await parseJsonRequest(request);
    const { candidate, category, reason } = body;

    if (!candidate || typeof candidate !== 'object') {
      return json({ error: 'candidate 必填', code: 'MISSING_CANDIDATE' }, 400);
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
      return json({ error: '地点名称和地址不能为空', code: 'INVALID_CANDIDATE' }, 400);
    }

    const result = await createLocation(env, {
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
      return json({
        status: 'saved',
        message: '地点已保存',
        location: result.location
      });
    }

    if (result.status === 'duplicate') {
      return json({
        status: 'duplicate',
        message: '地点已存在',
        reason: result.reason,
        existing: result.existing
      });
    }

    return json({
      error: '保存失败',
      message: result.message || '未知错误',
      code: 'SAVE_FAILED'
    }, 500);
  } catch (err) {
    console.error('[Edge OpenClaw Confirm] 错误:', err);

    if (err.status) {
      return json({
        error: err.message,
        code: err.code || 'INVALID_REQUEST'
      }, err.status);
    }

    return json({
      error: '服务器错误',
      message: err.message,
      code: 'INTERNAL_ERROR'
    }, 500);
  }
}
