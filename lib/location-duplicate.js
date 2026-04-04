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

  return left.length >= 2 &&
    right.length >= 2 &&
    (left.includes(right) || right.includes(left));
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
