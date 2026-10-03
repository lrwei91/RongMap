import { createRequire } from 'node:module';
import { describe, expect, it, vi, afterEach } from 'vitest';
process.env.RONGMAP_LEGACY_MODE = '1';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const require = createRequire(import.meta.url);
const store = require('../shared-store');
const handler = require('./roadbook-ai');
const response = () => ({ code: 200, body: null, headers: {}, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; }, setHeader(key,value) { this.headers[key]=value; } });
afterEach(() => vi.restoreAllMocks());
describe('AI planning endpoint authorization', () => {
  it('rejects locations outside the member space before contacting the AI', async () => {
    vi.spyOn(store,'getTrip').mockResolvedValue({ days: [{items:[]}] });
    vi.spyOn(store,'bootstrap').mockResolvedValue({locations:[{id:'allowed'}]});
    const res=response();
    await handler({ method:'POST',body:{tripId:'trip',locationIds:['foreign']},headers:{} },res);
    expect(res.code).toBe(403);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
  it('does not expose raw store errors', async () => {
    vi.spyOn(store,'getTrip').mockRejectedValue(new Error('private internal data'));
    const res=response();
    await handler({method:'POST',body:{tripId:'trip'},headers:{}},res);
    expect(res.body.error).toBe('AI规划暂时不可用');
  });
});
