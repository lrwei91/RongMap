// 由原项目 src/lib/location.js 与 lib/location-category.js 的常量迁移而来。
const CATEGORIES = {
  food: { label: '餐饮美食', short: '食' },
  spot: { label: '景点休闲', short: '景' },
  cafe_bar: { label: '日咖夜酒', short: '饮' }
};

const SOURCE_LABELS = {
  manual: '手动添加',
  text: 'AI 文本',
  map_location: '地图定位',
  douyin_url: '抖音',
  video: '视频内容',
  import: '批量导入'
};

const EMPTY_FILTERS = {
  keyword: '',
  category: 'all',
  geocoded: 'all',
  member: 'all',
  source: 'all',
  tag: 'all',
  sort: 'created'
};

// 与 locations.category 的 CHECK 语义保持一致，避免写入非预期值。
function normalizeCategory(value, fallback = 'food') {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, value) ? value : fallback;
}

module.exports = { CATEGORIES, SOURCE_LABELS, EMPTY_FILTERS, normalizeCategory };
