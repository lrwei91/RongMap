function coordinateOf(point = {}) {
  const latitude = point.latitude === '' || point.latitude == null ? NaN : Number(point.latitude);
  const longitude = point.longitude === '' || point.longitude == null ? NaN : Number(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function hasRouteCoordinates(point) {
  return Boolean(coordinateOf(point));
}

function haversineDistance(a, b) {
  const left = coordinateOf(a);
  const right = coordinateOf(b);
  if (!left || !right) return 0;
  const radians = (value) => value * Math.PI / 180;
  const dLatitude = radians(right.latitude - left.latitude);
  const dLongitude = radians(right.longitude - left.longitude);
  const latitude1 = radians(left.latitude);
  const latitude2 = radians(right.latitude);
  const value = Math.sin(dLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(dLongitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function routeDistance(points = []) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += haversineDistance(points[index - 1], points[index]);
  return total;
}

function buildDistanceMatrix(points) {
  return points.map((point, left) => points.map((other, right) => left === right ? 0 : haversineDistance(point.value, other.value)));
}

function matrixRouteDistance(order, matrix) {
  let total = 0;
  for (let index = 1; index < order.length; index += 1) total += matrix[order[index - 1]][order[index]];
  return total;
}

function nearestNeighbor(start, points, matrix) {
  const order = [start];
  const remaining = new Set(points.map((_, index) => index));
  remaining.delete(start);
  while (remaining.size) {
    const current = order[order.length - 1];
    let next = null;
    remaining.forEach((candidate) => {
      if (next == null
        || matrix[current][candidate] < matrix[current][next] - 1e-9
        || (Math.abs(matrix[current][candidate] - matrix[current][next]) <= 1e-9
          && points[candidate].originalIndex < points[next].originalIndex)) next = candidate;
    });
    order.push(next);
    remaining.delete(next);
  }
  return order;
}

function twoOpt(order, matrix, maxIterations) {
  let current = [...order];
  let currentDistance = matrixRouteDistance(current, matrix);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let bestLeft = -1;
    let bestRight = -1;
    let bestDelta = 0;
    for (let left = 0; left < current.length - 2; left += 1) {
      for (let right = left + 2; right < current.length; right += 1) {
        const before = matrix[current[left]][current[left + 1]]
          + (right + 1 < current.length ? matrix[current[right]][current[right + 1]] : 0);
        const after = matrix[current[left]][current[right]]
          + (right + 1 < current.length ? matrix[current[left + 1]][current[right + 1]] : 0);
        const delta = after - before;
        if (delta < bestDelta - 1e-9) {
          bestLeft = left;
          bestRight = right;
          bestDelta = delta;
        }
      }
    }
    if (bestLeft < 0) break;
    current = [
      ...current.slice(0, bestLeft + 1),
      ...current.slice(bestLeft + 1, bestRight + 1).reverse(),
      ...current.slice(bestRight + 1)
    ];
    currentDistance += bestDelta;
  }
  return { order: current, distance: currentDistance };
}

function optimizeRoute(points = [], options = {}) {
  const located = [];
  const unlocated = [];
  points.forEach((value, originalIndex) => {
    (hasRouteCoordinates(value) ? located : unlocated).push({ value, originalIndex });
  });
  const originalLocated = located.map((item) => item.value);
  const beforeKm = routeDistance(originalLocated);
  if (located.length < 3) {
    return { items: [...originalLocated, ...unlocated.map((item) => item.value)], beforeKm, afterKm: beforeKm, skipped: unlocated.length, improved: false };
  }
  const matrix = buildDistanceMatrix(located);
  const maxIterations = Number.isInteger(options.maxIterations) && options.maxIterations >= 0 ? options.maxIterations : located.length;
  let best = null;
  for (let start = 0; start < located.length; start += 1) {
    const order = nearestNeighbor(start, located, matrix);
    const candidate = { order, distance: matrixRouteDistance(order, matrix) };
    if (!best || candidate.distance < best.distance - 1e-9
      || (Math.abs(candidate.distance - best.distance) <= 1e-9
        && located[candidate.order[0]].originalIndex < located[best.order[0]].originalIndex)) best = candidate;
  }
  best = twoOpt(best.order, matrix, maxIterations);
  const improved = best.distance < beforeKm - 1e-9;
  const selected = improved ? best.order.map((index) => located[index].value) : originalLocated;
  return {
    items: [...selected, ...unlocated.map((item) => item.value)],
    beforeKm,
    afterKm: improved ? best.distance : beforeKm,
    skipped: unlocated.length,
    improved
  };
}

module.exports = { hasRouteCoordinates, haversineDistance, routeDistance, optimizeRoute };
