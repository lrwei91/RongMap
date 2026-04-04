const { normalizeText } = require('./location-record');
const { hasFiniteCoordinates } = require('./location-coordinates');

function getDistance(lat1, lon1, lat2, lon2) {
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

function areNamesSimilar(leftName, rightName) {
  const left = normalizeText(leftName);
  const right = normalizeText(rightName);

  if (!left || !right) return false;
  if (left === right) return true;

  // 严格要求：名称必须几乎相同，而不是简单的子串包含
  // 只有当较短的名称长度 >= 4 且被较长名称完整包含时，才认为相似
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  
  if (shorter.length < 4) return false;
  
  // 检查是否包含，但要求匹配度更高
  if (longer.includes(shorter)) {
    // 如果长度差异太大（超过 50%），认为不是同一个地点
    const lengthRatio = shorter.length / longer.length;
    return lengthRatio >= 0.5;
  }
  
  return false;
}

function isDuplicateLocation(newLoc, existingLocations) {
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

module.exports = {
  areNamesSimilar,
  getDistance,
  isDuplicateLocation
};
