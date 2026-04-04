import { applyLocationUpdates } from '../../../_lib/domain.js';
import { getLocations, saveLocations } from '../../../_lib/storage.js';
import { json, methodNotAllowed, parseJsonRequest } from '../../../_lib/http.js';

export async function onRequest(context) {
  const { request, env, params } = context;

  try {
    if (request.method !== 'PUT') {
      return methodNotAllowed();
    }

    const id = params && params.id;
    const { latitude, longitude } = await parseJsonRequest(request);
    const locations = await getLocations(env);
    const index = locations.findIndex((loc) => loc.id === id);

    if (index === -1) {
      return json({ error: '未找到该地点' }, 404);
    }

    locations[index] = applyLocationUpdates(locations[index], { latitude, longitude });
    await saveLocations(env, locations);

    return json(locations[index]);
  } catch (err) {
    console.error('edge geocode update handler error:', err);

    if (err.status) {
      return json({ error: err.message, code: err.code }, err.status);
    }

    return json({ error: `服务器错误：${err.message}` }, 500);
  }
}
