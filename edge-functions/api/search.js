import { DEFAULT_CITY, normalizePreferredCity, searchPlaces } from '../_lib/amap.js';
import { json, methodNotAllowed, parseJsonRequest } from '../_lib/http.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  try {
    const body = await parseJsonRequest(request);
    const { keywords, city } = body;

    if (!keywords) {
      return json({ error: '搜索关键词不能为空' }, 400);
    }

    const result = await searchPlaces({
      keywords,
      city: normalizePreferredCity(city || DEFAULT_CITY)
    }, env);

    return json(result);
  } catch (err) {
    if (err.status) {
      return json({ error: err.message, code: err.code }, err.status);
    }

    return json({ error: err.message || '搜索请求失败' }, 500);
  }
}
