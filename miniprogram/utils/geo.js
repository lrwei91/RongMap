// 由原项目 lib/location-coordinates.js 迁移而来（Haversine 距离）。
function isFiniteCoordinateValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function hasFiniteCoordinates(location) {
  return isFiniteCoordinateValue(location && location.latitude) &&
    isFiniteCoordinateValue(location && location.longitude);
}

function getDistanceInMeters(left, right) {
  if (!left || !right) return null;
  const lat1 = Number(left.latitude);
  const lon1 = Number(left.longitude);
  const lat2 = Number(right.latitude);
  const lon2 = Number(right.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;

  const earthRadius = 6371e3;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

module.exports = { getDistanceInMeters, hasFiniteCoordinates, isFiniteCoordinateValue };
