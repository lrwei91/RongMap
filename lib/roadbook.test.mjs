import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { normalizeRoadbook, inspectDay } = require('./roadbook');
const point = (name, longitude = 119.3) => ({ name, longitude, latitude: 26.1 });

describe('roadbook validation and live inspection', () => {
  it('preserves unknown costs and rejects invalid or excessive budgets', () => {
    expect(normalizeRoadbook({ tickets: [{ name: '门票', price: '' }, { name: '公园', price: 0 }] }).tickets.map((row) => row.price)).toEqual([null, 0]);
    expect(() => normalizeRoadbook({ budget: -1 })).toThrow();
    expect(() => normalizeRoadbook({ travelers: 'NaN' })).toThrow();
    expect(() => normalizeRoadbook({ tickets: Array.from({ length: 101 }, () => ({})) })).toThrow();
  });
  it('rejects a non-positive traveler count instead of silently defaulting to 1', () => {
    // 0 未被 number() 的负数/上界拦截，必须由人数规则显式拒绝
    expect(() => normalizeRoadbook({ travelers: 0 })).toThrow('出行人数必须至少为 1');
    // 负数先被通用数值范围拦截，同样不会静默变成 1
    expect(() => normalizeRoadbook({ travelers: -3 })).toThrow('预算或人数超出有效范围');
    expect(normalizeRoadbook({ travelers: 4 }).travelers).toBe(4);
    expect(normalizeRoadbook({}).travelers).toBe(1);
  });
  it('queries driving segments in order and deduplicates weather by district', async () => {
    const request = vi.fn(async (path) => {
      if (path.includes('driving')) return { status: '1', route: { paths: [{ distance: '300000', duration: '21600' }] } };
      if (path.includes('regeo')) return { status: '1', regeocode: { addressComponent: { adcode: '350102' } } };
      return { status: '1', forecasts: [{ city: '福州', reporttime: '2026-10-03 10:00', casts: [{ date: '2026-10-03' }] }] };
    });
    const result = await inspectDay({ days: [{ dayIndex: 1, items: [point('甲'), point('乙'), point('丙')] }] }, 1, request);
    expect(result.complete).toBe(true);
    expect(result.segments.map((row) => row.to)).toEqual(['乙', '丙']);
    expect(result.weather).toHaveLength(1);
    expect(result.warnings.join('')).toContain('超过8小时');
  });
  it('does not join across unlocated stops or present failed requests as zero-distance routes', async () => {
    const request = vi.fn(async () => { throw new Error('provider unavailable'); });
    const result = await inspectDay({ days: [{ dayIndex: 1, items: [point('甲'), { name: '未定位' }, point('乙'), point('丙')] }] }, 1, request);
    expect(result.complete).toBe(false);
    expect(result.segments).toEqual([]);
    expect(result.warnings.join('')).toContain('驾车路线核实失败');
    expect(request.mock.calls.filter(([path]) => path.includes('driving'))).toHaveLength(1);
  });
  it('does not use driving estimates for public transport', async () => {
    const request = vi.fn(async () => ({ status: '0' }));
    const result = await inspectDay({ roadbook: { mode: 'transit' }, days: [{ dayIndex: 1, items: [point('甲'), point('乙')] }] }, 1, request);
    expect(request.mock.calls.some(([path]) => path.includes('driving'))).toBe(false);
    expect(result.complete).toBe(false);
  });
});
