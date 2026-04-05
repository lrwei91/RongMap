const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');

const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local'), override: true });

const { kv } = require('@vercel/kv');

const LOCATIONS_KEY = 'locations';
const BACKUP_DIR = path.join(projectRoot, 'data', 'backups');

function hasKvEnv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function readLinkedProjectName() {
  const projectFile = path.join(projectRoot, '.vercel', 'project.json');
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
      cwd: projectRoot,
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

async function fetchLocationsFromKv() {
  if (!hasKvEnv()) {
    throw new Error('缺少 KV 直连环境变量');
  }

  const locations = await kv.get(LOCATIONS_KEY);
  return {
    locations: Array.isArray(locations) ? locations : [],
    source: 'vercel-kv'
  };
}

function fetchLocationsFromVercelDeployment() {
  const deploymentUrl = process.env.BACKUP_DEPLOYMENT_URL || getLatestReadyDeploymentUrl();
  const raw = execFileSync(
    'vercel',
    ['curl', '/api/locations', '--deployment', deploymentUrl, '--', '--silent', '--show-error'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20
    }
  );
  const payload = JSON.parse(extractJsonPayload(raw));

  if (!Array.isArray(payload)) {
    throw new Error('线上 /api/locations 返回了非数组数据');
  }

  return {
    locations: payload,
    source: deploymentUrl
  };
}

async function readRemoteLocations() {
  try {
    return await fetchLocationsFromKv();
  } catch (error) {
    console.warn(`直连 KV 失败，回退到 Vercel 部署代理: ${error.message}`);
    return fetchLocationsFromVercelDeployment();
  }
}

async function main() {
  const { locations, source } = await readRemoteLocations();
  const normalizedLocations = Array.isArray(locations) ? locations : [];
  const payload = JSON.stringify(normalizedLocations, null, 2);
  const snapshotName = `locations-${formatTimestamp()}.json`;
  const latestPath = path.join(BACKUP_DIR, 'locations-latest.json');
  const snapshotPath = path.join(BACKUP_DIR, snapshotName);

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(latestPath, payload, 'utf8');
  fs.writeFileSync(snapshotPath, payload, 'utf8');

  console.log(`已备份 ${normalizedLocations.length} 条地点数据`);
  console.log(`数据来源: ${source}`);
  console.log(`最新备份: ${latestPath}`);
  console.log(`快照文件: ${snapshotPath}`);
}

main().catch((error) => {
  console.error(`KV 备份失败: ${error.message}`);
  process.exitCode = 1;
});
