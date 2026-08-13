export const CATEGORIES = {
  food: { label: '餐饮美食', short: '食' },
  spot: { label: '景点休闲', short: '景' },
  cafe_bar: { label: '日咖夜酒', short: '饮' }
};

export const SOURCE_LABELS = {
  manual: '手动添加',
  text: 'AI 文本',
  map_location: '地图定位',
  douyin_url: '抖音',
  video: '视频内容',
  import: '批量导入'
};

export function hasCoordinates(location) {
  const latitude = location?.latitude;
  const longitude = location?.longitude;
  return latitude !== null && latitude !== undefined && latitude !== '' &&
    longitude !== null && longitude !== undefined && longitude !== '' &&
    Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
}

function poiText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('');
  return value == null ? '' : String(value).trim();
}

export function normalizeSearchPoi(poi = {}) {
  const name = poiText(poi.name);
  const [longitudeText = '', latitudeText = ''] = poiText(poi.location).split(',').map((value) => value.trim());
  const longitude = longitudeText === '' ? Number.NaN : Number(longitudeText);
  const latitude = latitudeText === '' ? Number.NaN : Number(latitudeText);
  const addressParts = [poi.pname, poi.cityname, poi.adname, poi.address]
    .map(poiText)
    .filter((value, index, list) => value && list.indexOf(value) === index);
  if (!name) return null;
  return {
    id: poiText(poi.id) || `${name}-${addressParts.join('')}`,
    name,
    address: addressParts.join('') || poiText(poi.address) || '地址待补充',
    latitude: Number.isFinite(latitude) ? latitude : '',
    longitude: Number.isFinite(longitude) ? longitude : '',
    district: poiText(poi.adname),
    city: poiText(poi.cityname),
    poiType: poiText(poi.type),
    sourceId: poiText(poi.id)
  };
}

export function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '时间未知';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(value).toLocaleDateString('zh-CN');
}

export function normalizeLocation(raw = {}) {
  return {
    ...raw,
    id: String(raw.id || crypto.randomUUID()),
    name: String(raw.name || '未命名地点'),
    address: String(raw.address || '暂无地址'),
    category: CATEGORIES[raw.category] ? raw.category : 'food',
    reason: String(raw.reason || ''),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    version: Number(raw.version) || 1,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
  };
}

export function matchesLocation(location, filters) {
  const keyword = filters.keyword.trim().toLowerCase();
  const haystack = [
    location.name,
    location.address,
    location.reason,
    ...(location.tags || []).map((tag) => tag.name || tag)
  ].join(' ').toLowerCase();

  if (keyword && !haystack.includes(keyword)) return false;
  if (filters.category !== 'all' && location.category !== filters.category) return false;
  if (filters.geocoded === 'yes' && !hasCoordinates(location)) return false;
  if (filters.geocoded === 'no' && hasCoordinates(location)) return false;
  if (filters.member !== 'all' && location.createdBy !== filters.member) return false;
  if (filters.source !== 'all' && (location.sourceType || 'manual') !== filters.source) return false;
  if (filters.tag !== 'all' && !(location.tags || []).some((tag) => (tag.id || tag) === filters.tag)) return false;
  return !location.deletedAt;
}

export function sortLocations(locations, sort) {
  const list = [...locations];
  if (sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  if (sort === 'updated') return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadLocations(locations, format = 'json') {
  const timestamp = new Date().toISOString().slice(0, 10);
  let content;
  let type;
  let extension;
  if (format === 'csv') {
    const headers = ['名称', '地址', '分类', '标签', '备注', '纬度', '经度', '添加时间'];
    const rows = locations.map((item) => [
      item.name,
      item.address,
      CATEGORIES[item.category]?.label || item.category,
      (item.tags || []).map((tag) => tag.name || tag).join('|'),
      item.reason,
      item.latitude,
      item.longitude,
      item.createdAt
    ].map(escapeCsv).join(','));
    content = `\uFEFF${[headers.join(','), ...rows].join('\r\n')}`;
    type = 'text/csv;charset=utf-8';
    extension = 'csv';
  } else {
    content = JSON.stringify(locations, null, 2);
    type = 'application/json;charset=utf-8';
    extension = 'json';
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = `rongmap-${timestamp}.${extension}`;
  link.click();
  URL.revokeObjectURL(link.href);
}
