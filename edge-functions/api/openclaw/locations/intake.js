import { json, methodNotAllowed, parseJsonRequest, unauthorized, getBearerToken } from '../../../_lib/http.js';
import { processLocationIntake } from '../../../_lib/intake.js';

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
    const result = await processLocationIntake(body || {}, env);
    return json(result);
  } catch (err) {
    console.error('[Edge OpenClaw Intake] 错误:', err);

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
