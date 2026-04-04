const { normalizeLocationCategory } = require('./location-category');

const LOCATION_MUTABLE_FIELDS = [
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

function normalizeText(value) {
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

function buildLocationRecord(locationData, options = {}) {
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

function applyLocationUpdates(existingLocation, updates) {
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

module.exports = {
  LOCATION_MUTABLE_FIELDS,
  applyLocationUpdates,
  buildLocationRecord,
  normalizeText
};
