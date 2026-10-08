const { test, expect } = require('@playwright/test');
const fs = require('fs');
const sources = [{ id: 'amap', name: '高德地图', platform: 'amap', status: 'queried', url: 'https://www.amap.com/', excerpt: '已查询地址与坐标' }, { id: 'xiaohongshu', name: '小红书', platform: 'xiaohongshu', status: 'not_configured' }, { id: 'dianping', name: '大众点评', platform: 'dianping', status: 'not_configured' }];
const places = [{ sourceId: 'B1', name: '三坊七巷', address: '福州市鼓楼区南后街', longitude: 119.296, latitude: 26.08, category: 'spot', rating: 4.8, averageCost: null }, { sourceId: 'B2', name: '本地小馆', address: '福州市鼓楼区元帅路', longitude: 119.29, latitude: 26.09, category: 'food', rating: 4.5, averageCost: 60 }];
const request = { destination: '福州', startDate: '2026-10-20', dayCount: 1, travelers: 2, mode: 'car', budget: 300, preferences: '带长辈慢游' };
function proposal() { return { name: '福州1天旅行攻略', description: '慢游', startDate: request.startDate, days: [{ dayIndex: 1, date: request.startDate, title: '老城慢游', items: places.map((poi, index) => ({ ...poi, id: `stop-${index}`, startTime: index ? '12:00' : '09:00', note: '预留休息时间' })) }], roadbook: { mode: 'car', travelers: 2, budget: 300, tickets: [], guide: { request, sources, places, overview: '轻松游老城，预留午休。', rainPlan: '雨天减少室外步行', stayAdvice: '优先靠近老城交通节点', pitfalls: ['开放时间待确认'], bookingChecklist: ['提前核实预约渠道'] } } }; }
function data(trips = []) { return { currentUser: { id: 'admin', name: '测试成员', role: 'admin' }, space: { id: 'space', name: '旅行测试空间' }, members: [], tags: [], locations: [], trips, activity: [], trash: [], shareLinks: [] }; }
async function mocks(page, existing = false) {
  let trip = existing ? { ...proposal(), id: 'guide-1', version: 1 } : null;
  let saves = 0;
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ json: data(trip ? [{ ...trip, dayCount: 1, itemCount: 2 }] : []) }));
  await page.route('**/api/v2/travel-guide', (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'collect') return route.fulfill({ json: { request, sources, places, warnings: [], researchToken: 'opaque-research' } });
    expect(body.sourceIds).toEqual(['B1', 'B2']);
    return route.fulfill({ json: { trip: proposal(), warnings: ['AI建议待核实'] } });
  });
  await page.route('**/api/v2/trips**', (route) => {
    if (['POST', 'PUT'].includes(route.request().method())) { saves++; trip = { ...route.request().postDataJSON(), id: 'guide-1', version: (trip?.version || 0) + 1 }; }
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, json: trip });
  });
  await page.route('**/api/v2/roadbook', (route) => route.fulfill({ json: { mode: 'car', queriedAt: '2026-10-08T14:00:00Z', complete: true, segments: [{ index: 1, from: '三坊七巷', to: '本地小馆', km: 2.5, hours: .2 }], weather: [], warnings: [] } }));
  return { getTrip: () => trip, saves: () => saves };
}
async function generate(page) {
  await page.getByLabel('目的地城市').fill('福州');
  await page.getByLabel('旅行天数').fill('1');
  await page.getByLabel('同行构成与偏好').fill('带长辈慢游');
  await page.getByRole('button', { name: '搜集候选地点', exact: true }).click();
  await expect(page.getByRole('heading', { name: '核对候选地点' })).toBeVisible();
  await page.getByRole('button', { name: '生成旅行攻略', exact: true }).click();
  await expect(page.getByRole('heading', { name: '行程概览' })).toBeVisible();
  await expect(page.locator('.guide-steps li').nth(2)).toHaveAttribute('aria-current', 'step');
}

test('replaces the roadbook tab and redirects old links without losing saved trips', async ({ page }) => {
  await mocks(page, true);
  await page.goto('/app/roadbook/guide-1');
  await expect(page).toHaveURL(/\/app\/travel\/guide-1/);
  await expect(page.locator('.nav-item', { hasText: '路书' })).toHaveCount(0);
  await expect(page.locator('.nav-item', { hasText: '攻略' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: '行程概览' })).toBeVisible();
  await expect(page.getByRole('button', { name: '规划草案' })).toHaveCount(0);
});

test('collects, previews, saves, reloads, verifies routes and exports source-preserving HTML', async ({ page }) => {
  const state = await mocks(page);
  await page.goto('/app/travel');
  await generate(page);
  expect(state.saves()).toBe(0);
  await page.getByRole('button', { name: '保存旅行攻略' }).click();
  await expect(page).toHaveURL(/\/app\/travel\/guide-1/);
  expect(state.saves()).toBe(1);
  expect(state.getTrip().roadbook.guide.sources).toHaveLength(3);
  await page.reload();
  await expect(page.getByText('轻松游老城，预留午休。')).toBeVisible();
  await page.getByRole('button', { name: '核验当天路线' }).click();
  await expect(page.getByText(/2.5 km · 约 12 分钟/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出攻略网页' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('福州1天旅行攻略-攻略.html');
  const html = fs.readFileSync(await file.path(), 'utf8');
  expect(html).toContain('来源与核验范围'); expect(html).toContain('2.5 km'); expect(html).not.toContain('<button'); expect(html).not.toContain('<script');
});

test('preserves requirements on source/model failure and supports retry', async ({ page }) => {
  await mocks(page);
  await page.route('**/api/v2/travel-guide', (route) => route.request().postDataJSON().action === 'collect' ? route.fulfill({ json: { request, sources, places, warnings: [], researchToken: 'opaque' } }) : route.fulfill({ status: 502, json: { error: 'AI服务繁忙，请稍后重试' } }));
  await page.goto('/app/travel');
  await page.getByLabel('目的地城市').fill('福州');
  await page.getByLabel('必须满足的安排与避忌').fill('保留午休，不爬山');
  await page.getByRole('button', { name: '搜集候选地点' }).click();
  await page.getByRole('button', { name: '生成旅行攻略' }).click();
  await expect(page.getByRole('alert')).toContainText('AI服务繁忙');
  await expect(page.getByLabel('必须满足的安排与避忌')).toHaveValue('保留午休，不爬山');
  await expect(page.getByRole('button', { name: '生成旅行攻略' })).toBeEnabled();
});

test('collects optional source details serially and falls back when a source fails', async ({ page }) => {
  await mocks(page);
  const calls = [];
  await page.unroute('**/api/v2/travel-guide');
  await page.route('**/api/v2/travel-guide', async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body.action === 'source' ? `${body.platform}:${body.step}` : body.action);
    const activeSources = sources.map((source) => source.id !== 'amap' ? { ...source, status: 'pending' } : source);
    if (body.action === 'source' && body.platform === 'dianping') return route.fulfill({ status: 502, json: { error: '服务离线' } });
    if (body.action === 'generate') return route.fulfill({ json: { trip: proposal(), warnings: [] } });
    return route.fulfill({ json: { request, sources: activeSources, places, warnings: [], researchToken: 'opaque', next: body.step === 'search' ? [{ id: 'note', title: '攻略笔记' }] : [] } });
  });
  await page.goto('/app/travel');
  await generate(page);
  expect(calls).toEqual(['collect', 'xiaohongshu:search', 'xiaohongshu:detail', 'dianping:search', 'generate']);
});

test('keeps generated draft on save conflict and guards navigation', async ({ page }) => {
  await mocks(page, true);
  await page.route('**/api/v2/trips?id=guide-1', (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 409, json: { error: '版本冲突' } }) : route.fulfill({ json: { ...proposal(), id: 'guide-1', version: 1 } }));
  await page.goto('/app/travel/guide-1');
  await page.getByRole('button', { name: '重新规划' }).click();
  await generate(page);
  await page.getByRole('button', { name: '保存旅行攻略' }).click();
  await expect(page.getByRole('alert')).toContainText('草稿已保留');
  await expect(page.getByText('轻松游老城，预留午休。')).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('.nav-item', { hasText: '我的' }).click();
  await expect(page).toHaveURL(/\/app\/travel/);
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`request, candidates and guide fit ${width}px without overflow`, async ({ page }) => {
    await mocks(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/app/travel');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await generate(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    if ([390, 1440].includes(width)) await page.screenshot({ path: `/tmp/rongmap-travel-guide-${width}.png`, fullPage: false });
    await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

test('public sharing renders saved guide evidence without edit actions', async ({ page }) => {
  await page.route('**/api/v2/public-share?token=guide', (route) => route.fulfill({ json: { type: 'trip', trip: { ...proposal(), id: 'guide-1' } } }));
  await page.goto('/share/guide');
  await expect(page.getByRole('heading', { name: '来源与核验范围' })).toBeVisible();
  await expect(page.getByText('雨天减少室外步行')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存旅行攻略' })).toHaveCount(0);
});
