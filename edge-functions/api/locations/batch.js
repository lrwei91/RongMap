import { buildLocationRecord } from '../../_lib/domain.js';
import { getLocations, saveLocations } from '../../_lib/storage.js';
import { json, methodNotAllowed, parseJsonRequest } from '../../_lib/http.js';

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (request.method !== 'POST') {
      return methodNotAllowed();
    }

    const body = await parseJsonRequest(request);
    const { locations: newLocations } = body;

    if (!Array.isArray(newLocations)) {
      return json({ error: '需要传入地点数组' }, 400);
    }

    const locations = await getLocations(env);
    const addedLocations = newLocations.map((loc, index) => buildLocationRecord({
      ...loc,
      sourceType: loc.sourceType || 'manual',
      sourcePlatform: loc.sourcePlatform || 'web',
      createdBy: loc.createdBy || 'user'
    }, {
      id: `${Date.now()}${index}`
    }));

    locations.push(...addedLocations);
    await saveLocations(env, locations);

    return json({ added: addedLocations.length, locations: addedLocations });
  } catch (err) {
    console.error('edge locations batch handler error:', err);

    if (err.status) {
      return json({ error: err.message, code: err.code }, err.status);
    }

    return json({ error: `服务器错误：${err.message}` }, 500);
  }
}
