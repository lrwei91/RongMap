import { applyLocationUpdates, buildLocationRecord } from '../../_lib/domain.js';
import { getLocations, saveLocations } from '../../_lib/storage.js';
import { getQueryParam, json, methodNotAllowed, parseJsonRequest } from '../../_lib/http.js';

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (request.method === 'GET') {
      const locations = await getLocations(env);
      return json(locations);
    }

    if (request.method === 'POST') {
      const body = await parseJsonRequest(request);
      const { name, address } = body;

      if (!name || !address) {
        return json({ error: '名称和地址不能为空' }, 400);
      }

      const locations = await getLocations(env);
      const newLocation = buildLocationRecord({
        ...body,
        sourceType: body.sourceType || 'manual',
        sourcePlatform: body.sourcePlatform || 'web',
        createdBy: body.createdBy || 'user'
      });

      locations.push(newLocation);
      await saveLocations(env, locations);

      return json(newLocation);
    }

    if (request.method === 'PUT') {
      const id = getQueryParam(request, 'id');

      if (!id) {
        return json({ error: '缺少地点 ID' }, 400);
      }

      const updates = await parseJsonRequest(request);
      const locations = await getLocations(env);
      const index = locations.findIndex((loc) => loc.id === id);

      if (index === -1) {
        return json({ error: '未找到该地点' }, 404);
      }

      locations[index] = applyLocationUpdates(locations[index], updates);
      await saveLocations(env, locations);

      return json(locations[index]);
    }

    if (request.method === 'DELETE') {
      const id = getQueryParam(request, 'id');

      if (!id) {
        return json({ error: '缺少地点 ID' }, 400);
      }

      const locations = await getLocations(env);
      const filtered = locations.filter((loc) => loc.id !== id);

      if (filtered.length === locations.length) {
        return json({ error: '未找到该地点' }, 404);
      }

      await saveLocations(env, filtered);
      return json({ success: true });
    }

    return methodNotAllowed();
  } catch (err) {
    console.error('edge locations handler error:', err);

    if (err.status) {
      return json({ error: err.message, code: err.code }, err.status);
    }

    return json({ error: `服务器错误：${err.message}` }, 500);
  }
}
