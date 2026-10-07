// Opt-in: real Gaode data and map rendering, with a test workspace (no Supabase writes).
const { test, expect } = require('@playwright/test');
test.skip(!process.env.RONGMAP_LIVE_DISCOVERY, 'Set RONGMAP_LIVE_DISCOVERY=1 for the live Gaode smoke check');

for (const width of [390, 1440]) test(`live discovery renders at ${width}px`, async ({ page }, testInfo) => {
  require('dotenv').config({ path: '.env.local', quiet: true });
  const { discoverRestaurants } = require('../../lib/restaurant-discovery');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ json: {
    currentUser: { id: 'test', name: '测试成员', role: 'member' }, space: { id: 'test', name: '界面验证空间' },
    members: [], locations: [], tags: [], trash: [], trips: [], activity: [], shareLinks: []
  } }));
  await page.route('**/api/v2/discovery', async (route) => {
    const result = await discoverRestaurants(route.request().postDataJSON().bounds);
    return route.fulfill({ json: result });
  });
  await page.goto('/app/map');
  await page.getByRole('button', { name: '发现小馆', exact: true }).click();
  const search = page.getByRole('button', { name: '搜索当前区域', exact: true });
  await expect(search).toBeEnabled({ timeout: 15000 });
  await search.click();
  await expect(page.locator('.discovery-card').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.map-state')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('discovery-live.png'), fullPage: true });
});
