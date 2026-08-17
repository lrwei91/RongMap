import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
process.env.RONGMAP_LEGACY_MODE = '1';
const { normalizeTripInput } = require('./shared-store');

describe('trip input normalization', () => {
  it('normalizes days, dates, snapshots and ordering', () => {
    const trip = normalizeTripInput({
      name: ' 福州周末 ', startDate: '2026-08-20',
      days: [{ dayIndex: 9, items: [{ id: 'item', locationId: 'location', name: '三坊七巷', address: '南后街', longitude: 119.29, latitude: 26.08 }] }]
    });
    expect(trip).toMatchObject({ name: '福州周末', startDate: '2026-08-20', itemCount: 1 });
    expect(trip.days[0]).toMatchObject({ dayIndex: 1, date: '2026-08-20' });
    expect(trip.days[0].items[0]).toMatchObject({ locationId: 'location', name: '三坊七巷', sortOrder: 0 });
  });

  it('rejects missing names and trips beyond the limits', () => {
    expect(() => normalizeTripInput({ name: '', days: [{}] })).toThrow('行程名称不能为空');
    expect(() => normalizeTripInput({ name: '超长行程', days: Array.from({ length: 31 }, () => ({})) })).toThrow('行程天数必须为 1 到 30 天');
    expect(() => normalizeTripInput({ name: '太多地点', days: [{ items: Array.from({ length: 201 }, (_, index) => ({ name: `地点${index}` })) }] })).toThrow('单个行程最多包含 200 个地点');
  });

  it('rejects calendar and clock values that only look formatted', () => {
    expect(() => normalizeTripInput({ name: '坏日期', startDate: '2026-02-30', days: [{}] })).toThrow('开始日期不是有效日期');
    expect(() => normalizeTripInput({ name: '坏日程', days: [{ date: '2026-13-01' }] })).toThrow('第 1 天日期不是有效日期');
    expect(() => normalizeTripInput({ name: '坏时间', days: [{ items: [{ name: '地点', startTime: '25:90' }] }] })).toThrow('开始时间不是有效时间');
  });
});
