export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers
    }
  });
}

export function methodNotAllowed(allowed) {
  const payload = { error: '方法不允许' };

  if (allowed) {
    payload.allowed = Array.isArray(allowed) ? allowed.join(', ') : allowed;
  }

  return json(payload, 405);
}

export function badRequest(error, extras = {}) {
  return json({ error, ...extras }, 400);
}

export function unauthorized(extras = {}) {
  return json({ error: '未授权', ...extras }, 401);
}

export function serverError(error, extras = {}) {
  return json({ error, ...extras }, 500);
}

export async function parseJsonRequest(request) {
  const text = await request.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    const error = new Error('请求体 JSON 无效');
    error.status = 400;
    error.code = 'INVALID_JSON_BODY';
    throw error;
  }
}

export function getQueryParam(request, name) {
  return new URL(request.url).searchParams.get(name);
}

export function getBearerToken(request) {
  const authHeader = request.headers.get('authorization') || '';

  if (!authHeader.startsWith('Bearer ')) {
    return '';
  }

  return authHeader.slice(7);
}
