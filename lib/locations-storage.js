/**
 * 地点存储共享 Helper
 * 统一封装 KV 读写操作，避免逻辑散落
 */

const fs = require('fs');
const path = require('path');
const { kv } = require('@vercel/kv');
const { execFileSync } = require('child_process');
const { buildLocationRecord, normalizeText } = require('./location-record');
const { isDuplicateLocation } = require('./location-duplicate');

const LOCATIONS_KEY = 'locations';
const LOCAL_LOCATIONS_FILE = path.join(process.cwd(), 'data', 'locations.local.json');

function hasKvConfig() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function getLocalLocations() {
  if (!fs.existsSync(LOCAL_LOCATIONS_FILE)) return [];
  const value = JSON.parse(fs.readFileSync(LOCAL_LOCATIONS_FILE, 'utf8'));
  return Array.isArray(value) ? value : [];
}

function saveLocalLocations(locations) {
  fs.mkdirSync(path.dirname(LOCAL_LOCATIONS_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_LOCATIONS_FILE, JSON.stringify(locations, null, 2), 'utf8');
}

function shouldReadFromDeployment() {
  return process.env.RONGMAP_REMOTE_FIRST !== '0' && process.env.VERCEL_ENV !== 'production';
}

function readLinkedProjectName() {
  const projectFile = path.join(process.cwd(), '.vercel', 'project.json');
  if (!fs.existsSync(projectFile)) {
    throw new Error('未找到 .vercel/project.json，无法自动定位线上部署');
  }

  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  if (!project.projectName) {
    throw new Error('Vercel 项目配置缺少 projectName');
  }

  return project.projectName;
}

function findJsonStartIndex(payload) {
  const objectIndex = payload.indexOf('{');
  const arrayIndex = payload.indexOf('[');

  if (objectIndex === -1) return arrayIndex;
  if (arrayIndex === -1) return objectIndex;
  return Math.min(objectIndex, arrayIndex);
}

function extractJsonPayload(payload) {
  const startIndex = findJsonStartIndex(payload);
  if (startIndex === -1) {
    throw new Error('Vercel CLI 未返回可解析的 JSON 数据');
  }

  return payload.slice(startIndex).trim();
}

function getLatestReadyDeploymentUrl() {
  const projectName = readLinkedProjectName();
  const raw = execFileSync(
    'vercel',
    ['list', projectName, '--status', 'READY', '--format', 'json'],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10
    }
  );
  const parsed = JSON.parse(raw);
  const latestDeployment = Array.isArray(parsed.deployments) ? parsed.deployments[0] : null;

  if (!latestDeployment || !latestDeployment.url) {
    throw new Error('未找到可用的 Vercel Ready 部署');
  }

  return `https://${latestDeployment.url}`;
}

function getLocationsFromDeployment() {
  const deploymentUrl = process.env.RONGMAP_REMOTE_DEPLOYMENT_URL || getLatestReadyDeploymentUrl();
  const raw = execFileSync(
    'vercel',
    ['curl', '/api/locations', '--deployment', deploymentUrl, '--', '--silent', '--show-error'],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20
    }
  );
  const locations = JSON.parse(extractJsonPayload(raw));

  if (!Array.isArray(locations)) {
    throw new Error('线上 /api/locations 返回了非数组数据');
  }

  return locations;
}

/**
 * 获取所有地点
 */
async function getLocations() {
  if (shouldReadFromDeployment()) {
    return getLocationsFromDeployment();
  }

  if (!hasKvConfig() && process.env.VERCEL_ENV !== 'production') {
    return getLocalLocations();
  }

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
  if (!hasKvConfig() && process.env.VERCEL_ENV !== 'production') {
    saveLocalLocations(locations);
    return;
  }
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
  normalizeText
};
