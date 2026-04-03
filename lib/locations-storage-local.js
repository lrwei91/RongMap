/**
 * 地点存储共享 Helper（本地测试版 - 使用文件存储）
 * 用于本地测试，无需 Vercel KV
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'locations.json');
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
  const R = 6371e3;
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
 */
function isDuplicateLocation(newLoc, existingLocations) {
  const newName = normalizeText(newLoc.name);
  const newAddress = normalizeText(newLoc.address);

  for (const existing of existingLocations) {
    const existingName = normalizeText(existing.name);
    const existingAddress = normalizeText(existing.address);

    if (newName === existingName && newAddress === existingAddress) {
      return { isDuplicate: true, reason: 'name_address_match', existing };
    }

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
 * 确保数据文件存在
 */
function ensureDataFile() {
  const dataDir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  }
}

/**
 * 获取所有地点（本地文件版）
 */
async function getLocations() {
  try {
    ensureDataFile();
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data) || [];
  } catch (err) {
    console.error('getLocations error:', err.message);
    return [];
  }
}

/**
 * 保存所有地点（本地文件版）
 */
async function saveLocations(locations) {
  try {
    ensureDataFile();
    fs.writeFileSync(DATA_FILE, JSON.stringify(locations, null, 2), 'utf8');
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
