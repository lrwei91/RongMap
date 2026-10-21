// 由原项目 src/lib/location.js 迁移而来（浏览器 API 部分已剔除）。
const { CATEGORIES, normalizeCategory } = require('./constants');

function hasCoordinates(location) {
  const latitude = location && location.latitude;
  const longitude = location && location.longitude;
  return latitude !== null && latitude !== undefined && latitude !== '' &&
    longitude !== null && longitude !== undefined && longitude !== '' &&
    Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
}

/**
 * 地点是否落在地图当前可视矩形内。
 * bounds 由 map-canvas 从 MapContext.getRegion() 归一化而来：{ south, west, north, east }。
 * 没有坐标的地点一律算「不在区域内」——它本来也画不到地图上。
 */
function isLocationInBounds(location, bounds) {
  if (!bounds || !hasCoordinates(location)) return false;
  const south = Number(bounds.south);
  const north = Number(bounds.north);
  const west = Number(bounds.west);
  const east = Number(bounds.east);
  if (!Number.isFinite(south) || !Number.isFinite(north) ||
      !Number.isFinite(west) || !Number.isFinite(east)) return false;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  return latitude >= south && latitude <= north && longitude >= west && longitude <= east;
}

function normalizeLocation(raw) {
  const source = raw || {};
  return Object.assign({}, source, {
    id: String(source.id || ''),
    name: String(source.name || '未命名地点'),
    address: String(source.address || '暂无地址'),
    category: normalizeCategory(source.category),
    reason: String(source.reason || ''),
    tags: Array.isArray(source.tags) ? source.tags : [],
    version: Number(source.version) || 1,
    createdAt: source.createdAt || new Date().toISOString(),
    updatedAt: source.updatedAt || source.createdAt || new Date().toISOString()
  });
}

function matchesLocation(location, filters) {
  const keyword = String((filters && filters.keyword) || '').trim().toLowerCase();
  const haystack = [
    location.name,
    location.address,
    location.reason,
    (location.tags || []).map(function (tag) { return tag.name || tag; }).join(' ')
  ].join(' ').toLowerCase();

  if (keyword && haystack.indexOf(keyword) === -1) return false;
  if (filters.category !== 'all' && location.category !== filters.category) return false;
  if (filters.geocoded === 'yes' && !hasCoordinates(location)) return false;
  if (filters.geocoded === 'no' && hasCoordinates(location)) return false;
  if (filters.member !== 'all' && location.createdBy !== filters.member) return false;
  if (filters.source !== 'all' && (location.sourceType || 'manual') !== filters.source) return false;
  if (filters.tag !== 'all' && !(location.tags || []).some(function (tag) {
    return String(tag.id || tag) === String(filters.tag);
  })) return false;
  return !location.deletedAt;
}

function sortLocations(locations, sort) {
  const list = locations.slice();
  if (sort === 'name') {
    return list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh-CN'); });
  }
  if (sort === 'updated') {
    return list.sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
  }
  return list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

// 导出内容与 Web 端列顺序保持一致，便于两边文件互认。
function locationsToCsv(locations) {
  const headers = ['名称', '地址', '分类', '标签', '备注', '纬度', '经度', '添加时间'];
  const rows = locations.map(function (item) {
    return [
      item.name,
      item.address,
      (CATEGORIES[item.category] || CATEGORIES.food).label,
      (item.tags || []).map(function (tag) { return tag.name || tag; }).join('|'),
      item.reason,
      item.latitude,
      item.longitude,
      item.createdAt
    ].map(escapeCsv).join(',');
  });
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}

function locationsToJson(locations) {
  return JSON.stringify(locations, null, 2);
}

module.exports = {
  hasCoordinates,
  isLocationInBounds,
  normalizeLocation,
  matchesLocation,
  sortLocations,
  escapeCsv,
  locationsToCsv,
  locationsToJson
};
