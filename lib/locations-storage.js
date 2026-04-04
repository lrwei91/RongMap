/**
 * 地点存储共享 Helper
 * 统一封装 KV 读写操作，避免逻辑散落
 */

const { kv } = require('@vercel/kv');
const { buildLocationRecord, normalizeText } = require('./location-record');
const { getDistance, isDuplicateLocation } = require('./location-duplicate');

const LOCATIONS_KEY = 'locations';

/**
 * 获取所有地点
 */
async function getLocations() {
  try {
    const data = await kv.get(LOCATIONS_KEY);
    return data || [];
  } catch (err) {
    console.error('getLocations error:', err.message);
    throw err;
  }
}

/**
 * 保存所有地点
 */
async function saveLocations(locations) {
  try {
    await kv.set(LOCATIONS_KEY, locations);
  } catch (err) {
    console.error('saveLocations error:', err.message);
    throw err;
  }
}

/**
 * 创建新地点
 */
async function createLocation(locationData) {
  const locations = await getLocations();
  const newLocation = buildLocationRecord(locationData);

  // 检查重复
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
  await saveLocations(locations);

  return {
    success: true,
    status: 'saved',
    location: newLocation
  };
}

module.exports = {
  getLocations,
  saveLocations,
  createLocation,
  isDuplicateLocation,
  normalizeText,
  getDistance
};
