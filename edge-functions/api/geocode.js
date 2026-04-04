import { geocodeAddress } from '../_lib/amap.js';
import { json, methodNotAllowed, parseJsonRequest } from '../_lib/http.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return methodNotAllowed();
  }

  try {
    const body = await parseJsonRequest(request);
    const { address } = body;

    if (!address) {
      return json({ error: '地址不能为空' }, 400);
    }

    const result = await geocodeAddress(address, env);
    return json(result);
  } catch (err) {
    if (err.status) {
      return json({ error: err.message, code: err.code }, err.status);
    }

    return json({ error: err.message || '地理编码请求失败' }, 500);
  }
}
