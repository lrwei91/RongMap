const CATEGORY_DEFINITIONS = {
  food: {
    label: '餐饮美食',
    aliases: ['餐饮', '美食', '咖啡', '小吃', '甜品', '饮品', '餐厅', '饭店']
  },
  spot: {
    label: '景点休闲',
    aliases: ['景点', '休闲', '景区', '公园', '乐园', '娱乐', '旅游']
  },
  shopping: {
    label: '购物消费',
    aliases: ['购物', '商场', '超市', '百货', '便利店', '消费']
  },
  traffic: {
    label: '交通枢纽',
    aliases: ['交通', '地铁', '高铁', '火车站', '汽车站', '机场', '码头']
  },
  medical: {
    label: '医疗服务',
    aliases: ['医疗', '医院', '诊所', '药店', '门诊']
  },
  education: {
    label: '教育培训',
    aliases: ['教育', '学校', '培训', '大学', '学院', '图书馆']
  },
  other: {
    label: '其他',
    aliases: ['其他', '其它']
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
