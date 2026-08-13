import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { validateLocation } = require('./shared-store');
const { hashToken } = require('../api/v2/share-links');

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
