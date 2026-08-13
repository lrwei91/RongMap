import { describe, expect, it } from 'vitest';
import { escapeCsv, hasCoordinates, matchesLocation, normalizeLocation, sortLocations } from './location';

const base = {
  id: 'one', name: '西湖公园', address: '福州市鼓楼区', category: 'spot', reason: '周末散步',
  latitude: 26.087, longitude: 119.283, createdBy: 'member-a', sourceType: 'manual',
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z', tags: [{ id: 'tag-weekend', name: '周末' }]
};

describe('location helpers', () => {
  it('normalizes legacy records', () => {
    expect(normalizeLocation({ name: '地点', address: '地址' })).toMatchObject({ category: 'food', version: 1, tags: [] });
  });

  it('recognizes coordinates only when both values are finite', () => {
    expect(hasCoordinates(base)).toBe(true);
    expect(hasCoordinates({ ...base, latitude: null })).toBe(false);
  });

  it('searches notes and tags and applies structured filters', () => {
    expect(matchesLocation(base, { keyword: '周末', category: 'spot', geocoded: 'yes', member: 'member-a', source: 'manual', tag: 'tag-weekend' })).toBe(true);
    expect(matchesLocation(base, { keyword: '', category: 'food', geocoded: 'all', member: 'all', source: 'all', tag: 'all' })).toBe(false);
  });

  it('sorts by name, created time, or updated time', () => {
    const second = { ...base, id: 'two', name: '鼓山', createdAt: '2026-08-03T00:00:00.000Z' };
    expect(sortLocations([base, second], 'created')[0].id).toBe('two');
    expect(sortLocations([base, second], 'name')[0].name).toBe('鼓山');
  });

  it('escapes RFC4180 cells', () => {
    expect(escapeCsv('a,"b"')).toBe('"a,""b"""');
  });
});
