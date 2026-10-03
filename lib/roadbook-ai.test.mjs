import { createRequire } from 'node:module';
import { describe, it, expect, vi, afterEach } from 'vitest';
const require = createRequire(import.meta.url);
const { buildMessages, validatePlan, readCompletion, generatePlan } = require('./roadbook-ai');
const points = [{ id: 'a', name: '真实地点', address: '真实地址', latitude: 26, longitude: 119, category: 'spot' }];
const trip = { id: 'trip', name: '行程', version: 1, startDate: '2026-10-03', days: [{ dayIndex: 1, items: [] }], roadbook: {} };
const plan = { days: [{ title: '慢游', items: [{ locationId: 'a', name: '伪造地点', latitude: 0, note: '散步' }] }], roadbook: { mode: 'walk', travelers: 2, tickets: [{ name: '门票', price: 999, source: '模型胡编' }] } };
afterEach(() => vi.unstubAllEnvs());
describe('AI planning trust boundary', () => {
  it('restores trusted location snapshots and prevents fabricated verified prices', () => {
    const result = validatePlan(JSON.stringify(plan), trip, points, 1);
    expect(result.days[0].items[0]).toMatchObject({ name: '真实地点', latitude: 26, locationId: 'a' });
    expect(result.roadbook.tickets[0]).toMatchObject({ price: null, source: 'AI建议，票价与预约待核实' });
    expect(result.days[0].date).toBe('2026-10-03');
    expect(result.roadbook.aiGenerated).toBe(true);
  });
  it('retains existing verified costs when suggesting additional items', () => {
    const existing = { ...trip, roadbook: { tickets: [{ name: '门票', price: 50, source: '用户核实' }] } };
    const result = validatePlan(JSON.stringify(plan), existing, points, 1);
    expect(result.roadbook.tickets).toEqual([{ name: '门票', price: 50, reservation: '', source: '用户核实' }]);
  });
  it('preserves a manual snapshot without inventing a database location reference', () => {
    const result = validatePlan(JSON.stringify(plan), trip, [{ ...points[0], isSnapshot: true, locationId: null }], 1);
    expect(result.days[0].items[0].locationId).toBe(null);
  });
  it('rejects nonexistent IDs, duplicate stops, invalid times and mismatched day counts', () => {
    expect(() => validatePlan(JSON.stringify(plan), trip, [], 1)).toThrow('未知或重复');
    expect(() => validatePlan(JSON.stringify({ ...plan, days: [{ items: [plan.days[0].items[0], plan.days[0].items[0]] }] }), trip, points, 1)).toThrow('未知或重复');
    expect(() => validatePlan(JSON.stringify({ ...plan, days: [{ items: [{ locationId: 'a', startTime: '99:00' }] }] }), trip, points, 1)).toThrow('无效');
    expect(() => validatePlan(JSON.stringify(plan), trip, points, 2)).toThrow('天数');
  });
  it('limits requests and includes only intended location fields', () => {
    expect(() => buildMessages(trip, points, { requirements: '' })).toThrow('旅行需求');
    const messages = buildMessages(trip, [{ ...points[0], reason: '私人备注', createdBy: '私人身份' }], { requirements: '一日游', dayCount: 1 });
    expect(messages[1].content).not.toContain('私人');
  });
  it('parses split streaming UTF-8 chunks and detects truncation', async () => {
    const bytes = new TextEncoder().encode('data: '+JSON.stringify({ choices: [{ delta: { content: '中文' } }] })+'\r\n\r\ndata: [DONE]\n');
    const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 48)); controller.enqueue(bytes.slice(48)); controller.close(); } });
    expect(await readCompletion(new Response(stream))).toBe('中文');
    await expect(readCompletion(new Response('data: {"choices":[{"finish_reason":"length"}]}\n'))).rejects.toThrow('过长');
  });
  it('keeps upstream errors and credentials out of returned errors', async () => {
    vi.stubEnv('MONK_API_KEY', 'test-private-key');
    const fetchImpl = vi.fn(async () => { throw new Error('Authorization: Bearer test-private-key'); });
    await expect(generatePlan(trip, points, { requirements: '一日游' }, fetchImpl)).rejects.toThrow('连接失败');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer test-private-key');
  });
});
