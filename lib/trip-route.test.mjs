import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { hasRouteCoordinates, haversineDistance, routeDistance, optimizeRoute } = require('./trip-route');

describe('trip route optimizer', () => {
  const point = (id, longitude, latitude) => ({ id, longitude, latitude });

  it('validates coordinates without treating blanks as zero', () => {
    expect(hasRouteCoordinates(point('ok', 119.3, 26.1))).toBe(true);
    expect(hasRouteCoordinates(point('blank', '', ''))).toBe(false);
    expect(hasRouteCoordinates(point('range', 181, 26))).toBe(false);
  });

  it('calculates haversine and route distance in kilometers', () => {
    expect(haversineDistance(point('a', 119.296531, 26.061473), point('a', 119.296531, 26.061473))).toBe(0);
    expect(haversineDistance(point('a', 119.296531, 26.061473), point('b', 119.306531, 26.061473))).toBeCloseTo(1, 1);
    expect(routeDistance([point('a', 119.296531, 26.061473), point('b', 119.306531, 26.061473)])).toBeGreaterThan(0);
  });

  it('optimizes located items and keeps unlocated items at the end', () => {
    const input = [
      point('a', 0, 0),
      point('c', 2, 0),
      point('b', 1, 0),
      { id: 'missing', longitude: null, latitude: null }
    ];
    const result = optimizeRoute(input);
    expect(result.afterKm).toBeLessThanOrEqual(result.beforeKm);
    expect(result.items.at(-1).id).toBe('missing');
    expect(result.skipped).toBe(1);
    expect(input.map((item) => item.id)).toEqual(['a', 'c', 'b', 'missing']);
  });

  it('is deterministic and preserves an already optimal sequence', () => {
    const input = [point('a', 0, 0), point('b', 1, 0), point('c', 2, 0)];
    expect(optimizeRoute(input).items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(optimizeRoute(input).items.map((item) => item.id)).toEqual(optimizeRoute(input).items.map((item) => item.id));
  });

  it('keeps the 200-place upper bound practical', () => {
    const input = Array.from({ length: 200 }, (_, index) => point(
      String(index),
      119 + ((index * 61) % 100) / 1000,
      26 + ((index * 37) % 100) / 1000
    ));
    const started = performance.now();
    const result = optimizeRoute(input);
    expect(result.items).toHaveLength(200);
    expect(result.afterKm).toBeLessThanOrEqual(result.beforeKm + 1e-9);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
