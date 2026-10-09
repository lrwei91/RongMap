import { describe, expect, it, vi } from 'vitest';
import { locateOnAmap } from './geolocation';

const coords = { longitude: 119.296531, latitude: 26.061473, accuracy: 25 };
const success = { getCurrentPosition: vi.fn((callback) => callback({ coords })) };

describe('browser location on AMap', () => {
  it('converts fresh GPS coordinates before exposing a map position', async () => {
    const position = { lng: 119.301, lat: 26.058 };
    const convertFrom = vi.fn((input, type, callback) => callback('complete', { locations: [position] }));
    await expect(locateOnAmap({ convertFrom }, success)).resolves.toEqual({ position, accuracy: 25 });
    expect(convertFrom).toHaveBeenCalledWith([119.296531, 26.061473], 'gps', expect.any(Function));
    expect(success.getCurrentPosition).toHaveBeenLastCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });

  it('never falls back to unconverted GPS when conversion fails', async () => {
    await expect(locateOnAmap({ convertFrom: (input, type, callback) => callback('error', {}) }, success)).rejects.toThrow('坐标转换失败');
    await expect(locateOnAmap({}, success)).rejects.toThrow('坐标转换暂不可用');
    await expect(locateOnAmap({ convertFrom() { throw new Error('SDK error'); } }, success)).rejects.toThrow('坐标转换失败');
  });

  it('times out stalled conversion', async () => {
    vi.useFakeTimers();
    try {
      const promise = locateOnAmap({ convertFrom() {} }, success);
      const assertion = expect(promise).rejects.toThrow('坐标转换超时');
      await vi.advanceTimersByTimeAsync(10000);
      await assertion;
    } finally { vi.useRealTimers(); }
  });

  it.each([[1, '定位权限被拒绝'], [2, '暂时无法获取位置'], [3, '定位超时']])('explains browser error %s', async (code, message) => {
    await expect(locateOnAmap({}, { getCurrentPosition: (ok, fail) => fail({ code }) })).rejects.toThrow(message);
  });

  it('explains missing geolocation', async () => {
    await expect(locateOnAmap({}, null)).rejects.toThrow('不支持定位');
  });
});
