const { test, expect } = require('@playwright/test');

const restaurants = [
  { id: 'discovery:one', sourceId: 'one', name: '榕城面馆', category: 'food', address: '福州市鼓楼区北大路1号', poiType: '餐饮服务;中餐厅', city: '福州市', district: '鼓楼区', longitude: 119.3, latitude: 26.08, rating: 4.9, averageCost: null },
  { id: 'discovery:two', sourceId: 'two', name: '瑞幸咖啡(福州店)', category: 'cafe_bar', address: '福州市鼓楼区北大路2号', poiType: '餐饮服务;咖啡厅', longitude: 119.301, latitude: 26.08, rating: 4.2, averageCost: 20 },
  { id: 'discovery:three', sourceId: 'three', name: '榕城家常菜', category: 'food', address: '福州市鼓楼区北大路3号', poiType: '餐饮服务;中餐厅', longitude: 119.302, latitude: 26.08, rating: 4.5, averageCost: 80 }
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.AMap = {
      Map: class {
        constructor() { this.events = {}; this.bounds = { west: 119.29, east: 119.31, south: 26.07, north: 26.09 }; window.discoveryTestMap = this; }
        getBounds() { const b = this.bounds; return { getSouthWest: () => ({ getLng: () => b.west, getLat: () => b.south }), getNorthEast: () => ({ getLng: () => b.east, getLat: () => b.north }) }; }
        on(event, fn) { (this.events[event] ||= []).push(fn); }
        off(event, fn) { this.events[event] = (this.events[event] || []).filter((item) => item !== fn); }
        setZoomAndCenter() {}
        destroy() {}
      },
      Marker: class { on() {} setMap() {} setContent() {} setPosition() {} setzIndex() {} }
    };
  });
  const data = { currentUser: { id: 'member', name: '测试成员', role: 'member' }, space: { id: 'test', name: '测试共享空间' }, members: [], tags: [], locations: [], trash: [], trips: [], activity: [], shareLinks: [] };
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ json: data }));
  await page.route('**/api/v2/discovery', (route) => route.fulfill({ json: { restaurants, bounds: route.request().postDataJSON().bounds, fetchedAt: '2026-10-07T12:00:00Z', partial: false } }));
  await page.route('**/api/v2/locations', (route) => {
    const location = route.request().postDataJSON();
    data.locations.push({ ...location, id: `saved-${location.sourceId}`, version: 1, createdAt: new Date().toISOString() });
    return route.fulfill({ json: { location: data.locations.at(-1) } });
  });
});

async function openDiscovery(page) {
  await page.goto('/app/map');
  await page.getByRole('button', { name: '发现小馆', exact: true }).click();
  await page.getByRole('button', { name: '搜索当前区域', exact: true }).click();
  await expect(page.locator('.discovery-card')).toHaveCount(3);
}

test('discovery filters, collects once and feeds the existing locations view', async ({ page }) => {
  await openDiscovery(page);
  await page.getByLabel('人均预算').selectOption('30');
  await expect(page.locator('.discovery-card')).toHaveCount(2);
  await page.getByLabel('保留价格未知').uncheck();
  await expect(page.locator('.discovery-card')).toHaveCount(1);
  await page.getByLabel('隐藏常见连锁').check();
  await expect(page.getByText('没有符合筛选的餐馆')).toBeVisible();
  await page.getByLabel('人均预算').selectOption('');
  await page.getByLabel('类型', { exact: true }).selectOption('food');
  await page.getByLabel('筛选搜索结果').fill('面馆');
  await page.getByRole('button', { name: '收藏榕城面馆', exact: true }).click();
  await expect(page.getByRole('button', { name: '收藏榕城面馆', exact: true })).toBeDisabled();
  await expect(page.getByText('已收藏「榕城面馆」到共享地点')).toBeVisible();
  await page.getByRole('button', { name: '已收藏', exact: true }).click();
  await expect(page.locator('.location-card', { hasText: '榕城面馆' })).toBeVisible();
});

test('changed viewport does not query automatically and failed searches retain previous candidates', async ({ page }) => {
  let calls = 0;
  page.on('request', (request) => { if (request.url().includes('/api/v2/discovery')) calls++; });
  await openDiscovery(page);
  await page.evaluate(() => { window.discoveryTestMap.bounds.east += 0.001; window.discoveryTestMap.events.moveend.forEach((fn) => fn()); });
  await expect(page.getByText('地图范围已改变，点击搜索刷新结果。')).toBeVisible();
  expect(calls).toBe(1);
  await page.route('**/api/v2/discovery', (route) => route.fulfill({ status: 502, json: { error: '餐饮搜索暂时不可用，请稍后重试' } }));
  await page.getByRole('button', { name: '搜索当前区域', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('下方保留上次结果');
  await expect(page.locator('.discovery-card')).toHaveCount(3);
});

test('partial results and duplicate collections explain the state', async ({ page }) => {
  await page.route('**/api/v2/discovery', (route) => route.fulfill({ json: { restaurants, bounds: route.request().postDataJSON().bounds, fetchedAt: '2026-10-07T12:00:00Z', partial: true } }));
  await page.route('**/api/v2/locations', (route) => route.fulfill({ status: 409, json: { error: '地点已存在' } }));
  await openDiscovery(page);
  await expect(page.getByText('部分区域搜索失败，结果不完整，请重试。')).toBeVisible();
  await page.getByRole('button', { name: '收藏榕城面馆', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('该地点已在共享空间中收藏');
});

for (const width of [320, 390, 768, 1440]) test(`discovery fits ${width}px without horizontal overflow`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openDiscovery(page);
  await expect(page.getByLabel('发现小馆地图', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '收藏榕城面馆', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  if (width < 768) {
    const panel = page.locator('.discovery-panel');
    await panel.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByRole('button', { name: '收藏榕城家常菜', exact: true })).toBeVisible();
  }
});

test('discovery remains usable with enlarged text and mobile landscape', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 740, height: 390 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDiscovery(page);
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await page.getByRole('button', { name: '收藏榕城面馆', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '收藏榕城面馆', exact: true }).click();
  await expect(page.getByRole('button', { name: '收藏榕城面馆', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
