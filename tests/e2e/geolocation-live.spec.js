const { test, expect } = require('@playwright/test');
test.skip(!process.env.RONGMAP_LIVE_GEOLOCATION, 'Set RONGMAP_LIVE_GEOLOCATION=1 for real AMap rendering and conversion');

for (const width of [390, 1440]) test(`real AMap locates simulated GPS at ${width}px`, async ({ page, context }, testInfo) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ longitude: 119.296531, latitude: 26.061473, accuracy: 30 });
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ json: {
    currentUser: { id: 'test', name: '测试成员', role: 'member' }, space: { id: 'test', name: '定位测试' },
    members: [], locations: [], tags: [], trash: [], trips: [], activity: [], shareLinks: []
  } }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app/map');
  const button = page.getByRole('button', { name: '定位我的位置' });
  await expect(button).toBeEnabled({ timeout: 15000 });
  await button.click();
  await expect(page.locator('.map-location-status')).toContainText('已定位，精度约 30 米', { timeout: 20000 });
  const marker = page.getByRole('img', { name: '我的位置' });
  await expect(marker).toBeVisible();
  // A centered marker proves the SDK rendered the overlay at the focused position.
  await expect.poll(async () => {
    const bounds = await marker.boundingBox();
    const canvas = await page.locator('.map-canvas').boundingBox();
    return Math.max(Math.abs(bounds.x + bounds.width / 2 - canvas.x - canvas.width / 2),
      Math.abs(bounds.y + bounds.height / 2 - canvas.y - canvas.height / 2));
  }).toBeLessThan(5);
  await page.screenshot({ path: testInfo.outputPath('real-amap-location.png') });
  expect(errors).toEqual([]);
});
