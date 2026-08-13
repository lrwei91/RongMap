import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const v2Dispatcher = require('../api/v2/[route]');
const openclawDispatcher = require('../api/openclaw/locations/[action]');

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

describe('Vercel API dispatchers', () => {
  it('exposes every v2 route through one serverless function', () => {
    expect(Object.keys(v2Dispatcher.handlers).sort()).toEqual([
      'bootstrap', 'bulk', 'import-commit', 'import-preview', 'locations',
      'members', 'public-share', 'share-links', 'tags', 'trash'
    ]);
  });

  it('dispatches a v2 route without changing req/res', async () => {
    const original = v2Dispatcher.handlers.bootstrap;
    const target = vi.fn(async (req, res) => res.status(204).json({ route: req.query.route }));
    v2Dispatcher.handlers.bootstrap = target;
    const req = { method: 'GET', query: { route: 'bootstrap' } };
    const res = createResponse();
    await v2Dispatcher(req, res);
    expect(target).toHaveBeenCalledWith(req, res);
    expect(res).toMatchObject({ statusCode: 204, body: { route: 'bootstrap' } });
    v2Dispatcher.handlers.bootstrap = original;
  });

  it('returns 404 for unknown v2 and OpenClaw routes', async () => {
    const v2Response = createResponse();
    const openclawResponse = createResponse();
    await v2Dispatcher({ query: { route: 'missing' } }, v2Response);
    await openclawDispatcher({ query: { action: 'missing' } }, openclawResponse);
    expect(v2Response).toMatchObject({ statusCode: 404, body: { error: '接口不存在' } });
    expect(openclawResponse).toMatchObject({ statusCode: 404, body: { error: '接口不存在' } });
  });

  it('keeps both OpenClaw actions behind one function', () => {
    expect(Object.keys(openclawDispatcher.handlers).sort()).toEqual(['confirm', 'intake']);
  });
});
