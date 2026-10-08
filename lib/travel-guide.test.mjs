import { createRequire } from 'node:module';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const require = createRequire(import.meta.url);
const { collectResearch, generateGuide, enrichResearch, readResearch, signResearch } = require('./travel-guide');
const { normalizeRequest, normalizeGuide, sourceUrl } = require('./travel-guide-record');
const { normalizeRoadbook, inspectDay } = require('./roadbook');
const { createHandler } = require('./api-v2/travel-guide');
const { completeMessages } = require('./roadbook-ai');
const { callMcp, querySource } = require('./travel-sources');
const identity = { spaceId: 'space', user: { id: 'user' } };
const input = { destination: '福州', dayCount: 1, travelers: 2, mode: 'walk', budget: 200, startDate: '2026-10-20', preferences: '慢游' };
const poi = { id: 'B1', name: '真实公园', address: '公园路1号', location: '119.3,26.1', cityname: '福州市', typecode: '110101', business: { rating: '4.5', cost: '' } };
const query = async (path) => path.includes('geocode') ? { status: '1', geocodes: [{ adcode: '350100' }] } : { status: '1', pois: [poi, { ...poi, id: 'invalid', location: '' }] };
beforeEach(() => { vi.stubEnv('AMAP_WEB_SERVICE_KEY', 'test-private-key'); vi.stubEnv('XHS_MCP_URL', ''); vi.stubEnv('CN_SCRAPER_URL', ''); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('travel guide evidence pipeline', () => {
  it('collects real coordinate candidates, deduplicates, and identifies unavailable sources', async () => {
    const result = await collectResearch(input, identity, query);
    expect(result.places).toHaveLength(1);
    expect(result.places[0]).toMatchObject({ sourceId: 'B1', rating: 4.5, averageCost: null });
    expect(result.sources.filter((source) => source.status === 'not_configured')).toHaveLength(2);
    expect(readResearch(result.researchToken, identity).request).toEqual(normalizeRequest(input));
  });
  it('prevents tampering, cross-user reuse, expiry and unknown selected locations before model invocation', async () => {
    const result = await collectResearch(input, identity, query);
    expect(() => readResearch(result.researchToken + 'x', identity)).toThrow('校验失败');
    expect(() => readResearch(result.researchToken, { ...identity, user: { id: 'other' } })).toThrow('不属于');
    const complete = vi.fn();
    await expect(generateGuide({ researchToken: result.researchToken, sourceIds: ['unknown'] }, identity, complete)).rejects.toThrow('不在');
    expect(complete).not.toHaveBeenCalled();
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 31 * 60000);
    expect(() => readResearch(result.researchToken, identity)).toThrow('过期');
  });
  it('preserves user constraints, trusted POIs and references while rejecting invented IDs and verified prices', async () => {
    const result = await collectResearch({ ...input, sources: [{ title: '用户摘录', url: 'https://www.xiaohongshu.com/explore/example?xsec_token=private', excerpt: '提前确认预约' }] }, identity, query);
    const complete = vi.fn(async () => JSON.stringify({ days: [{ title: '慢游', items: [{ locationId: 'poi:B1', latitude: 0, name: '伪造', startTime: '09:00' }] }], roadbook: { travelers: 9, mode: 'car', budget: 999, tickets: [{ name: '门票', price: 50 }] }, guide: { overview: '慢游计划', rainPlan: '遇雨减少室外活动', pitfalls: ['预约待核实'] } }));
    const planned = await generateGuide({ researchToken: result.researchToken, sourceIds: ['B1'] }, identity, complete);
    expect(planned.trip.days[0].items[0]).toMatchObject({ name: '真实公园', latitude: 26.1, locationId: null });
    expect(planned.trip.roadbook).toMatchObject({ travelers: 2, mode: 'walk', budget: 200 });
    expect(planned.trip.roadbook.tickets[0].price).toBeNull();
    expect(planned.trip.roadbook.guide.sources.at(-1).url).not.toContain('private');
    expect(normalizeRoadbook(planned.trip.roadbook).guide.overview).toBe('慢游计划');
    expect(complete.mock.calls[0][0][1].content).toContain('提前确认预约');
  });
  it('reports provider authentication failures as configuration errors without exposing credentials', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-private-key');
    await expect(completeMessages([{ role: 'user', content: 'test' }], async () => new Response('private headers', { status: 401 }))).rejects.toMatchObject({ status: 503, message: 'AI服务鉴权失败，请检查服务端配置' });
  });
  it('validates inputs and keeps upstream failures distinct from empty searches', async () => {
    for (const patch of [{ dayCount: 0 }, { travelers: 0 }, { startDate: '2026-02-30' }, { budget: -1 }]) expect(() => normalizeRequest({ ...input, ...patch })).toThrow();
    await expect(collectResearch(input, identity, async (path) => path.includes('geocode') ? { status: '1', geocodes: [{ adcode: '350100' }] } : { status: '0' })).rejects.toMatchObject({ status: 502 });
    expect(sourceUrl('javascript:alert(1)')).toBe('');
    expect(sourceUrl('https://user:secret@example.com')).toBe('');
  });
  it('authenticates before consuming external quota and sanitizes unknown failures', async () => {
    const response = () => ({ setHeader: vi.fn(), status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
    const collect = vi.fn(); const denied = response();
    await createHandler(async () => { throw Object.assign(new Error('请登录'), { status: 401 }); }, collect)({ method: 'POST', body: { action: 'collect' } }, denied);
    expect(denied.code).toBe(401); expect(collect).not.toHaveBeenCalled();
    const failed = response();
    await createHandler(async () => identity, async () => { throw new Error('private request headers'); })({ method: 'POST', body: { action: 'collect' } }, failed);
    expect(failed.body.error).not.toContain('private');
  });
  it('queries walking and transit estimates through their actual providers', async () => {
    const points = [{ name: '甲', longitude: 119.3, latitude: 26.1 }, { name: '乙', longitude: 119.31, latitude: 26.1 }];
    for (const mode of ['walk', 'transit']) {
      const request = vi.fn(async (path) => {
        if (path.includes('regeo')) return { status: '1', regeocode: { addressComponent: { citycode: '0591', adcode: '350102' } } };
        if (path.includes('weather')) return { status: '1', forecasts: [] };
        return mode === 'walk' ? { status: '1', route: { paths: [{ distance: '1000', duration: '900' }] } } : { status: '1', route: { distance: '2000', transits: [{ duration: '1200' }] } };
      });
      const result = await inspectDay({ roadbook: { mode }, days: [{ dayIndex: 1, items: points }] }, 1, request);
      expect(result.complete).toBe(true); expect(result.mode).toBe(mode);
      expect(request.mock.calls.some(([path]) => path.includes('driving'))).toBe(false);
      expect(result.segments[0].hours).toBe(mode === 'walk' ? .25 : 1 / 3);
    }
  });
});

describe('optional source service connectors', () => {
  it('speaks MCP JSON/SSE with session headers and only read-only calls', async () => {
    vi.stubEnv('XHS_MCP_URL', 'http://127.0.0.1:18060/mcp');
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (!body.id) return new Response(null, { status: 202 });
      const result = body.method === 'initialize' ? { protocolVersion: '2024-11-05' } : { content: [{ type: 'text', text: JSON.stringify({ feeds: [] }) }] };
      return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`, { headers: { 'mcp-session-id': 'session', 'content-type': 'text/event-stream' } });
    });
    expect(await callMcp('xiaohongshu', 'search_feeds', { keyword: '福州' }, fetchImpl)).toEqual({ feeds: [] });
    expect(fetchImpl.mock.calls[2][1].headers['mcp-session-id']).toBe('session');
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).params.name).toBe('search_feeds');
  });
  it('keeps source access fields encrypted and out of saved evidence, and degrades on failures', async () => {
    const research = readResearch((await collectResearch(input, identity, query)).researchToken, identity);
    const call = async (_platform, tool) => tool === 'search_feeds' ? { feeds: [{ id: 'note', xsecToken: 'private-note-token', noteCard: { displayTitle: '福州避坑' } }] } : { data: { note: { desc: '临行前确认预约' }, comments: [{ content: '雨天慢游' }] } };
    const found = await querySource('xiaohongshu', 'search', research, '', call);
    research.sources.push(...found.sources);
    const token = signResearch(research, identity);
    expect(token).not.toContain('private-note-token');
    expect(JSON.stringify(found)).not.toContain('private-note-token');
    const read = await enrichResearch({ researchToken: token, platform: 'xiaohongshu', step: 'detail', noteId: 'note' }, identity, (...args) => querySource(...args, call));
    expect(JSON.stringify(read.sources)).not.toContain('private-note-token');
    expect(read.sources.at(-1).excerpt).toContain('雨天慢游');
    const failed = await enrichResearch({ researchToken: token, platform: 'dianping', step: 'search' }, identity, async () => { throw new Error('cookie=private'); });
    expect(failed.sources.find((source) => source.id === 'dianping').status).toBe('failed');
    expect(readResearch(failed.researchToken, identity).places).toHaveLength(1);
  });
});
