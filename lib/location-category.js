const CATEGORY_DEFINITIONS = {
  food: {
    label: '餐饮美食',
    aliases: ['餐饮', '美食', '小吃', '甜品', '饮品', '餐厅', '饭店']
  },
  spot: {
    label: '景点休闲',
    aliases: ['景点', '休闲', '景区', '公园', '乐园', '娱乐', '旅游']
  },
  cafe_bar: {
    label: '日咖夜酒',
    aliases: ['咖啡', '咖啡店', '咖啡馆', '酒吧', '精酿', '小酒馆', 'bistro', 'bar']
  }
};

function normalizeCategoryText(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, '')
    : '';
}

function normalizeLocationCategory(value, options = {}) {
  const fallback = Object.prototype.hasOwnProperty.call(options, 'fallback')
    ? options.fallback
    : null;
  const normalized = normalizeCategoryText(value);

  if (!normalized) {
    return fallback;
  }

  if (CATEGORY_DEFINITIONS[normalized]) {
    return normalized;
  }

  for (const [category, definition] of Object.entries(CATEGORY_DEFINITIONS)) {
    const candidates = [definition.label, ...(definition.aliases || [])]
      .map(normalizeCategoryText)
      .filter(Boolean);

    if (candidates.some((candidate) => candidate === normalized)) {
      return category;
    }

    if (candidates.some((candidate) => candidate.length >= 2 && normalized.includes(candidate))) {
      return category;
    }
  }

  return fallback;
}

module.exports = {
  CATEGORY_DEFINITIONS,
  normalizeLocationCategory
};
