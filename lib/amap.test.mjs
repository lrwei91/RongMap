import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
const { searchPlaces } = createRequire(import.meta.url)('./amap');
const shop = { id: 'B0M2VZJGUT', name: '明猪平凡烤肉', district: '福建省福州市仓山区', adcode: '350104', address: '恩歌城市公寓13A商铺', location: '119.270745,26.029141' };

describe('place search recall', () => {
  it('recalls a store omitted by text search using input tips with coordinates', async () => {
    const query = vi.fn(async (path) => path.includes('inputtips') ? { status: '1', tips: [shop] } : { status: '1', pois: [] });
    const result = await searchPlaces({ keywords: shop.name }, query);
    expect(result.pois).toHaveLength(1);
    expect(result.pois[0]).toMatchObject({ id: shop.id, cityname: '福州市', adname: '仓山区', location: shop.location });
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('merges even when text search returns unrelated results, deduplicates and ranks exact names first', async () => {
    const other = { ...shop, id: 'other', name: '平凡韩食' };
    const result = await searchPlaces({ keywords: shop.name }, async (path) => path.includes('inputtips') ? { status: '1', tips: [shop, other, { name: '公交线路', location: [] }] } : { status: '1', pois: [{ ...other, cityname: '福州市' }] });
    expect(result.pois.map((poi) => poi.id)).toEqual([shop.id, 'other']);
  });
  it('keeps valid results during partial failure but never reports an outage as empty', async () => {
    const query = async (path) => path.includes('inputtips') ? { status: '0', info: 'INVALID_USER_KEY' } : { status: '1', pois: [shop] };
    expect(await searchPlaces({ keywords: shop.name }, query)).toMatchObject({ partial: true, pois: [shop] });
    await expect(searchPlaces({ keywords: shop.name }, async () => ({ status: '0' }))).rejects.toMatchObject({ status: 502 });
    await expect(searchPlaces({ keywords: shop.name }, async (path) => {
      if (path.includes('inputtips')) throw new Error('timeout');
      return { status: '1', pois: [] };
    })).rejects.toMatchObject({ status: 502 });
  });
  it('retains nationwide fallback only after both local sources return no matches', async () => {
    const query = vi.fn(async (path, params) => ({ status: '1', pois: params.city ? [] : [shop], tips: [] }));
    expect((await searchPlaces({ keywords: shop.name }, query)).pois).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(3);
  });
  it('rejects invalid keywords before consuming quota', async () => {
    const query = vi.fn();
    for (const keywords of ['', '   ', {}, 'a'.repeat(81)]) await expect(searchPlaces({ keywords }, query)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });
});
