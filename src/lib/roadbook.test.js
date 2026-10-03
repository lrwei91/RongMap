import { describe, expect, it } from 'vitest';
import { budgetTotal, navigationUrl, roadbookHtml } from './roadbook';
describe('roadbook export and costs', () => {
  it('distinguishes unknown costs from free tickets', () => {
    expect(budgetTotal([{ price: null }, { price: '' }, { price: 0 }, { price: '20.5' }])).toEqual({ total: 20.5, unknown: 2 });
  });
  it('escapes user content in standalone HTML and uses only generated navigation URLs', () => {
    const html = roadbookHtml({ name: '<script>alert(1)</script>', days: [{ dayIndex: 1, items: [{ name: '危险"<img>', note: '<script>' }] }], roadbook: { tickets: [{ name: '<svg>', price: null, source: 'javascript:alert(1)' }] } });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('待核实');
  });
  it('refuses navigation when an adjacent point is unlocated', () => {
    expect(navigationUrl({ name: '甲', latitude: null, longitude: 119 }, { latitude: 26, longitude: 119 })).toBe(null);
  });
});
