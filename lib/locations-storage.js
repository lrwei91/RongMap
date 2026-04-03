/**
 * 地点存储共享 Helper
 * 统一封装 KV 读写操作，避免逻辑散落
 */

const { kv } = require('@vercel/kv');

const LOCATIONS_KEY = 'locations';

/**
 * 规范化地点名称和地址（用于去重比较）
 */
function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * 计算两点间距离（Haversine 公式）
 */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // 地球半径（米）
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 检查地点是否重复
 * 规则：
 * 1. 先按规范化后的 name + address 精确去重
 * 2. 若候选和已有记录都带坐标，再做一次近似坐标去重（距离 < 50 米）
 */
function isDuplicateLocation(newLoc, existingLocations) {
  const newName = normalizeText(newLoc.name);
  const newAddress = normalizeText(newLoc.address);

  for (const existing of existingLocations) {
    // 规则 1: name + address 精确匹配
    const existingName = normalizeText(existing.name);
    const existingAddress = normalizeText(existing.address);

    if (newName === existingName && newAddress === existingAddress) {
      return { isDuplicate: true, reason: 'name_address_match', existing };
    }

    // 规则 2: 坐标近似（距离 < 50 米）
    if (
      newLoc.latitude && newLoc.longitude &&
      existing.latitude && existing.longitude
    ) {
      const distance = getDistance(
        parseFloat(newLoc.latitude),
        parseFloat(newLoc.longitude),
        parseFloat(existing.latitude),
        parseFloat(existing.longitude)
      );

      if (distance < 50) {
        return { isDuplicate: true, reason: 'coordinate_proximity', existing, distance };
      }
    }
  }

  return { isDuplicate: false };
}

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

  const newLocation = {
    id: Date.now().toString(),
    name: locationData.name,
    address: locationData.address,
    reason: locationData.reason || null,
    category: locationData.category || null,
    latitude: locationData.latitude || null,
    longitude: locationData.longitude || null,
    createdAt: new Date().toISOString()
  };

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
