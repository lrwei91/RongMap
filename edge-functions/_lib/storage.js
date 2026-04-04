import { buildLocationRecord, getDistance, isDuplicateLocation, normalizeText } from './domain.js';

const LOCATIONS_KEY = 'locations';

function getKv(env) {
  const kv = env && env.RONGMAP_KV;

  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    throw new Error('未绑定 RONGMAP_KV');
  }

  return kv;
}

export async function getLocations(env) {
  try {
    const data = await getKv(env).get(LOCATIONS_KEY, { type: 'json' });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('getLocations error:', err.message);
    throw err;
  }
}

export async function saveLocations(env, locations) {
  try {
    await getKv(env).put(LOCATIONS_KEY, JSON.stringify(locations));
  } catch (err) {
    console.error('saveLocations error:', err.message);
    throw err;
  }
}

export async function createLocation(env, locationData) {
  const locations = await getLocations(env);
  const newLocation = buildLocationRecord(locationData);
  const duplicateCheck = isDuplicateLocation(newLocation, locations);

  if (duplicateCheck.isDuplicate) {
    return {
      success: false,
      status: 'duplicate',
      message: '地点已存在',
      reason: duplicateCheck.reason,
      existing: duplicateCheck.existing
    };
  }

  locations.push(newLocation);
  await saveLocations(env, locations);

  return {
    success: true,
    status: 'saved',
    location: newLocation
  };
}

export {
  getDistance,
  isDuplicateLocation,
  normalizeText
};
