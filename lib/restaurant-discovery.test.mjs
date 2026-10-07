import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { validateBounds, discoverRestaurants } = require('./restaurant-discovery');
const { createHandler } = require('./api-v2/discovery');
const bounds = { west: 119.29, east: 119.31, south: 26.07, north: 26.09 };
const poi = { id: 'poi-1', name: '福州小馆', typecode: '050100', type: '餐饮服务;中餐厅', adcode: '350102', cityname: '福州市', adname: '鼓楼区', address: '北大路1号', location: '119.3,26.08', business: { rating: '4.9', cost: '' } };

describe('restaurant discovery', () => {
  it('rejects absent, inverted, oversized and out-of-city bounds before querying', () => {
    for (const input of [null, {}, { ...bounds, east: null }, { ...bounds, east: 119.2 }, { ...bounds, east: 119.5 }, { ...bounds, west: 116 }]) expect(() => validateBounds(input)).toThrow();
  });
  it('deduplicates city restaurants and keeps high scores and unknown prices', async () => {
    const result = await discoverRestaurants(bounds, async () => ({ status: '1', pois: [poi, poi, { ...poi, id: 'outside', adcode: '350200' }, { ...poi, id: 'shop', typecode: '060100' }, { ...poi, id: 'far', location: '119.6,26.08' }] }));
    expect(result.restaurants).toHaveLength(1);
    expect(result.restaurants[0]).toMatchObject({ sourceId: 'poi-1', rating: 4.9, averageCost: null, category: 'food' });
    expect(result.partial).toBe(false);
  });
  it('reports partial failures and never turns a complete outage into an empty result', async () => {
    let calls = 0;
    const large = { ...bounds, east: 119.34 };
    const result = await discoverRestaurants(large, async () => ++calls === 1 ? { status: '1', pois: [poi] } : { status: '0' });
    expect(result.partial).toBe(true);
    expect(result.restaurants).toHaveLength(1);
    await expect(discoverRestaurants(bounds, async () => { throw new Error('upstream secret'); })).rejects.toMatchObject({ status: 502 });
  });
  it('requires identity before consuming the upstream quota', async () => {
    const query = vi.fn();
    const response = { setHeader: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await createHandler(async () => { throw Object.assign(new Error('请登录'), { status: 401 }); }, query)({ method: 'POST', body: { bounds } }, response);
    expect(response.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
