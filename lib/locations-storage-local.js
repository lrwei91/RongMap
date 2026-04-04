/**
 * 地点存储共享 Helper（本地测试版 - 使用文件存储）
 * 用于本地测试，无需 Vercel KV
 */

const fs = require('fs');
const path = require('path');
const { buildLocationRecord, normalizeText } = require('./location-record');
const { getDistance, isDuplicateLocation } = require('./location-duplicate');

const DATA_FILE = path.join(__dirname, '..', 'data', 'locations.json');

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
