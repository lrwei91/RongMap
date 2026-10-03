import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateLocation, toDb, TRASH_RETENTION_DAYS, trashCutoff } = require('./shared-store');
const { hashToken } = require('./api-v2/share-links');
const identity = { spaceId: 'space-1', user: { id: 'user-1', name: '小榕' } };

describe('shared store validation', () => {
  it('accepts a complete location', () => {
    expect(() => validateLocation({ name: '地点', address: '福州', latitude: 26, longitude: 119 })).not.toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => validateLocation({ name: '', address: '福州' })).toThrow('名称和地址不能为空');
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => validateLocation({ name: '地点', address: '福州', latitude: 91, longitude: 119 })).toThrow('纬度');
    expect(() => validateLocation({ name: '地点', address: '福州', latitude: 26, longitude: 181 })).toThrow('经度');
  });

  it('hashes public tokens deterministically without retaining the token', () => {
    expect(hashToken('TOKEN')).toBe(hashToken('TOKEN'));
    expect(hashToken('TOKEN')).not.toContain('TOKEN');
  });
});

// city/district 是 areAdministrativeAreasCompatible 判重规则的输入；toDb 漏写会让判重静默退化。
describe('location persistence columns', () => {
  it('persists duplicate-detection columns and normalizes the address', () => {
    const row = toDb({ name: '地点', address: ' 福建省 福州市 鼓楼区 ', city: '福州市', district: '鼓楼区', sourceId: 'poi-1', poiType: '餐饮服务', confidence: '0.8' }, identity);
    expect(row.city).toBe('福州市');
    expect(row.district).toBe('鼓楼区');
    expect(row.source_id).toBe('poi-1');
    expect(row.poi_type).toBe('餐饮服务');
    expect(row.normalized_address).toBe('福建省福州市鼓楼区');
    expect(row.confidence).toBe(0.8);
  });

  it('keeps confidence numeric and rule_decision as jsonb', () => {
    const row = toDb({ name: '地点', address: '福州', confidence: '0.5', ruleDecision: { rule: 'near' } }, identity);
    expect(typeof row.confidence).toBe('number');
    expect(row.rule_decision).toEqual({ rule: 'near' });
    expect(toDb({ name: '地点', address: '福州', confidence: 'high' }, identity).confidence).toBeNull();
  });

  it('falls back to existing values instead of nulling omitted fields', () => {
    const existing = { name: '旧名', address: '旧地址', city: '福州市', district: '鼓楼区' };
    const row = toDb({ reason: '值得去' }, identity, existing);
    expect(row.name).toBe('旧名');
    expect(row.city).toBe('福州市');
    expect(row.district).toBe('鼓楼区');
  });
});

describe('trash retention', () => {
  it('cuts off at 30 days so the UI countdown matches real deletion', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
    const now = Date.parse('2026-10-31T00:00:00Z');
    expect(trashCutoff(now)).toBe('2026-10-01T00:00:00.000Z');
  });
});
