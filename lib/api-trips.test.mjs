import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.RONGMAP_LEGACY_MODE = '1';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const require = createRequire(import.meta.url);
const store = require('./shared-store');
const handler = require('./api-v2/trips');

function response() {
  return { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; } };
}

describe('trips api', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates and loads a trip through the flat v2 route contract', async () => {
    vi.spyOn(store, 'saveTrip').mockResolvedValue({ id: 'trip-1', name: '周末路线', version: 1 });
    vi.spyOn(store, 'getTrip').mockResolvedValue({ id: 'trip-1', name: '周末路线', version: 1, days: [] });
    const created = response();
    await handler({ method: 'POST', query: {}, body: { name: '周末路线', days: [{}] } }, created);
    expect(created).toMatchObject({ statusCode: 201, body: { id: 'trip-1' } });
    const loaded = response();
    await handler({ method: 'GET', query: { id: 'trip-1' } }, loaded);
    expect(loaded).toMatchObject({ statusCode: 200, body: { id: 'trip-1', version: 1 } });
  });

  it('returns the latest trip on optimistic version conflict', async () => {
    const conflict = new Error('行程已被其他成员修改');
    conflict.status = 409;
    conflict.latest = { id: 'trip-1', version: 3 };
    conflict.localSummary = { localVersion: 2, latestVersion: 3, changedFields: ['每日安排'] };
    vi.spyOn(store, 'saveTrip').mockRejectedValue(conflict);
    const res = response();
    await handler({ method: 'PUT', query: { id: 'trip-1' }, body: { version: 2 } }, res);
    expect(res).toMatchObject({ statusCode: 409, body: { error: '行程已被其他成员修改', latest: { version: 3 }, localSummary: { changedFields: ['每日安排'] } } });
  });

  it('dispatches route optimization and validates missing ids', async () => {
    vi.spyOn(store, 'optimizeTrip').mockResolvedValue({ id: 'trip-1', optimization: [] });
    const optimized = response();
    await handler({ method: 'PUT', query: { id: 'trip-1' }, body: { action: 'optimize', version: 1 } }, optimized);
    expect(store.optimizeTrip).toHaveBeenCalled();
    const missing = response();
    await handler({ method: 'DELETE', query: {} }, missing);
    expect(missing.statusCode).toBe(400);
  });
});
