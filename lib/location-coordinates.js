function isFiniteCoordinateValue(value) {
  return value !== null &&
    value !== undefined &&
    value !== '' &&
    Number.isFinite(Number(value));
}

function hasFiniteCoordinates(location) {
  return isFiniteCoordinateValue(location && location.latitude) &&
    isFiniteCoordinateValue(location && location.longitude);
}

module.exports = {
  hasFiniteCoordinates,
  isFiniteCoordinateValue
};
