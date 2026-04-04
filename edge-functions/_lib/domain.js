export const CATEGORY_DEFINITIONS = {
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

export const LOCATION_MUTABLE_FIELDS = [
  'name',
  'address',
  'reason',
  'category',
  'latitude',
  'longitude',
  'sourceType',
  'sourcePlatform',
  'sourceContent',
  'confidence',
  'matchType',
  'poiType',
  'normalizedAddress',
  'city',
  'district',
  'createdBy',
  'ruleDecision'
];

function normalizeCategoryText(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, '')
    : '';
}

export function normalizeLocationCategory(value, options = {}) {
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

export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeOptionalText(value, maxLength = 0) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (maxLength > 0) {
    return trimmed.slice(0, maxLength);
  }

  return trimmed;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export function isFiniteCoordinateValue(value) {
  return value !== null &&
    value !== undefined &&
    value !== '' &&
    Number.isFinite(Number(value));
}

export function hasFiniteCoordinates(location) {
  return isFiniteCoordinateValue(location && location.latitude) &&
    isFiniteCoordinateValue(location && location.longitude);
}

export function buildLocationRecord(locationData, options = {}) {
  const existing = options.existing || {};
  const name = normalizeOptionalText(locationData.name, 120) || existing.name || '';
  const address = normalizeOptionalText(locationData.address, 240) || existing.address || '';

  return {
    id: options.id || existing.id || Date.now().toString(),
    name,
    address,
    reason: locationData.reason !== undefined
      ? normalizeOptionalText(locationData.reason, 240)
      : (existing.reason || null),
    category: locationData.category !== undefined
      ? normalizeLocationCategory(locationData.category, { fallback: null })
      : normalizeLocationCategory(existing.category, { fallback: null }),
    latitude: locationData.latitude !== undefined
      ? normalizeNumber(locationData.latitude)
      : (existing.latitude ?? null),
    longitude: locationData.longitude !== undefined
      ? normalizeNumber(locationData.longitude)
      : (existing.longitude ?? null),
    sourceType: locationData.sourceType !== undefined
      ? normalizeOptionalText(locationData.sourceType, 40)
      : (existing.sourceType || null),
    sourcePlatform: locationData.sourcePlatform !== undefined
      ? normalizeOptionalText(locationData.sourcePlatform, 40)
      : (existing.sourcePlatform || null),
    sourceContent: locationData.sourceContent !== undefined
      ? normalizeOptionalText(locationData.sourceContent, 400)
      : (existing.sourceContent || null),
    confidence: locationData.confidence !== undefined
      ? normalizeOptionalText(locationData.confidence, 20)
      : (existing.confidence || null),
    matchType: locationData.matchType !== undefined
      ? normalizeOptionalText(locationData.matchType, 40)
      : (existing.matchType || null),
    poiType: locationData.poiType !== undefined
      ? normalizeOptionalText(locationData.poiType, 120)
      : (existing.poiType || null),
    normalizedAddress: normalizeText(address),
    city: locationData.city !== undefined
      ? normalizeOptionalText(locationData.city, 40)
      : (existing.city || null),
    district: locationData.district !== undefined
      ? normalizeOptionalText(locationData.district, 40)
      : (existing.district || null),
    createdBy: locationData.createdBy !== undefined
      ? normalizeOptionalText(locationData.createdBy, 40)
      : (existing.createdBy || null),
    ruleDecision: locationData.ruleDecision !== undefined
      ? normalizeOptionalText(locationData.ruleDecision, 40)
      : (existing.ruleDecision || null),
    createdAt: options.createdAt || existing.createdAt || new Date().toISOString()
  };
}

export function applyLocationUpdates(existingLocation, updates) {
  const partial = {};

  LOCATION_MUTABLE_FIELDS.forEach((field) => {
    if (updates[field] !== undefined) {
      partial[field] = updates[field];
    }
  });

  const next = buildLocationRecord(partial, {
    existing: existingLocation,
    id: existingLocation.id,
    createdAt: existingLocation.createdAt
  });

  const addressUpdated = partial.address !== undefined;
  const latitudeUpdated = partial.latitude !== undefined;
  const longitudeUpdated = partial.longitude !== undefined;
  const addressChanged = addressUpdated &&
    normalizeText(existingLocation.address) !== normalizeText(next.address);

  if (addressChanged && !latitudeUpdated && !longitudeUpdated) {
    next.latitude = null;
    next.longitude = null;
  }

  return next;
}

export function getDistance(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371e3;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

export function areNamesSimilar(leftName, rightName) {
  const left = normalizeText(leftName);
  const right = normalizeText(rightName);

  if (!left || !right) return false;
  if (left === right) return true;

  return left.length >= 2 &&
    right.length >= 2 &&
    (left.includes(right) || right.includes(left));
}

export function isDuplicateLocation(newLoc, existingLocations) {
  const newName = normalizeText(newLoc.name);
  const newAddress = normalizeText(newLoc.address);

  for (const existing of existingLocations) {
    const existingName = normalizeText(existing.name);
    const existingAddress = normalizeText(existing.address || existing.normalizedAddress);

    if (newName && newAddress && newName === existingName && newAddress === existingAddress) {
      return { isDuplicate: true, reason: 'name_address_match', existing };
    }

    if (hasFiniteCoordinates(newLoc) && hasFiniteCoordinates(existing)) {
      const distance = getDistance(
        parseFloat(newLoc.latitude),
        parseFloat(newLoc.longitude),
        parseFloat(existing.latitude),
        parseFloat(existing.longitude)
      );

      if (distance < 50 && areNamesSimilar(newLoc.name, existing.name)) {
        return { isDuplicate: true, reason: 'coordinate_proximity', existing, distance };
      }
    }
  }

  return { isDuplicate: false };
}
