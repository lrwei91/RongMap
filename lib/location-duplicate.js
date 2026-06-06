const { normalizeText } = require('./location-record');
const { getDistanceInMeters, hasFiniteCoordinates } = require('./location-coordinates');

const STRICT_COORDINATE_DUPLICATE_DISTANCE_METERS = 20;
const ADDRESS_SUBSTRING_MIN_LENGTH = 8;

function areNamesExactlyEqual(leftName, rightName) {
  const left = normalizeText(leftName);
  const right = normalizeText(rightName);

  if (!left || !right) return false;
  return left === right;
}

function areAddressesCompatible(leftAddress, rightAddress) {
  const left = normalizeText(leftAddress);
  const right = normalizeText(rightAddress);

  if (!left || !right) return false;
  if (left === right) return true;

  return (
    left.length >= ADDRESS_SUBSTRING_MIN_LENGTH &&
    right.includes(left)
  ) || (
    right.length >= ADDRESS_SUBSTRING_MIN_LENGTH &&
    left.includes(right)
  );
}

function areAdministrativeAreasCompatible(leftLocation, rightLocation) {
  const leftCity = normalizeText(leftLocation && leftLocation.city);
  const rightCity = normalizeText(rightLocation && rightLocation.city);
  const leftDistrict = normalizeText(leftLocation && leftLocation.district);
  const rightDistrict = normalizeText(rightLocation && rightLocation.district);

  if (!leftDistrict || !rightDistrict) return false;
  if (leftCity && rightCity && leftCity !== rightCity) return false;

  return leftDistrict === rightDistrict;
}

function isDuplicateLocation(newLoc, existingLocations) {
  const newName = normalizeText(newLoc.name);
  const newAddress = normalizeText(newLoc.address);
  const newSourceId = normalizeText(newLoc.sourceId);

  for (const existing of existingLocations) {
    const existingName = normalizeText(existing.name);
    const existingAddress = normalizeText(existing.address || existing.normalizedAddress);
    const existingSourceId = normalizeText(existing.sourceId);

    if (newSourceId && existingSourceId && newSourceId === existingSourceId) {
      return { isDuplicate: true, reason: 'source_id_match', existing };
    }

    if (newName && newAddress && newName === existingName && newAddress === existingAddress) {
      return { isDuplicate: true, reason: 'name_address_match', existing };
    }

    if (newName && existingName && newName === existingName && areAddressesCompatible(newAddress, existingAddress)) {
      return { isDuplicate: true, reason: 'name_address_compatible', existing };
    }

    if (hasFiniteCoordinates(newLoc) && hasFiniteCoordinates(existing)) {
      const distance = getDistanceInMeters(
        { latitude: newLoc.latitude, longitude: newLoc.longitude },
        { latitude: existing.latitude, longitude: existing.longitude }
      );

      if (
        distance !== null &&
        distance <= STRICT_COORDINATE_DUPLICATE_DISTANCE_METERS &&
        areNamesExactlyEqual(newLoc.name, existing.name) &&
        (
          areAddressesCompatible(newLoc.address, existing.address || existing.normalizedAddress) ||
          areAdministrativeAreasCompatible(newLoc, existing)
        )
      ) {
        return { isDuplicate: true, reason: 'coordinate_exact_name_match', existing, distance };
      }
    }
  }

  return { isDuplicate: false };
}

module.exports = {
  areAdministrativeAreasCompatible,
  areAddressesCompatible,
  areNamesExactlyEqual,
  isDuplicateLocation
};
