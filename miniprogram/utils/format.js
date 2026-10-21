// 由原项目 src/lib/location.js 的时间与分类文案逻辑迁移而来。
const { CATEGORIES } = require('./constants');

function relativeTime(value) {
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
  return formatDate(value);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function categoryLabel(category) {
  return (CATEGORIES[category] || CATEGORIES.food).label;
}

function categoryShort(category) {
  return (CATEGORIES[category] || CATEGORIES.food).short;
}

/**
 * 列表卡片需要的展示字段一次性算好，随列表数据一起下发。
 * 这样 location-card 不必挂 observer：一次列表刷新原本会触发「每张卡一次 setData」，
 * 现在只在页面侧做一遍字符串拼接。
 * 注意写入的是同名新键（categoryLabel / categoryShort / relative / authorLabel），
 * 不会覆盖 locationFromRow 出来的任何字段。
 */
function decorateLocation(location) {
  if (!location) return location;
  return Object.assign({}, location, {
    categoryLabel: categoryLabel(location.category),
    categoryShort: categoryShort(location.category),
    relative: relativeTime(location.createdAt),
    // 与 Web 端 card/detail 的回退词保持一致：缺记录时也显示「空间成员」，
    // 和「我的」页成员列表里未填称呼的成员显示成同一个词，不会出现两种说法。
    authorLabel: location.createdByName || '空间成员'
  });
}

module.exports = { relativeTime, formatDate, formatDateTime, categoryLabel, categoryShort, decorateLocation };
