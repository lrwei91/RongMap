const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ json: {
    currentUser: { id: 'test', name: '测试成员', role: 'member' }, space: { id: 'test', name: '定位测试' },
    members: [], locations: [], tags: [], trash: [], trips: [], activity: [], shareLinks: []
  } }));
  await page.addInitScript(() => {
    window.locationTest = { markers: [], circles: [], mode: 'success', calls: 0 };
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition(ok, fail) {
      window.locationTest.calls++;
      setTimeout(() => window.locationTest.mode === 'denied' ? fail({ code: 1 }) : ok({ coords: { longitude: 119.296531, latitude: 26.061473, accuracy: 150 } }), 30);
    } } });
    window.AMap = {
      Map: class {
        constructor(container) { this.container = container; window.locationTest.map = this; }
        setZoomAndCenter(zoom, center) { this.center = center; }
        destroy() { window.locationTest.destroyed = true; }
      },
      Marker: class {
        constructor(options) { this.options = options; this.element = document.createElement('div'); this.element.innerHTML = options.content; options.map.container.append(this.element); window.locationTest.markers.push(this); }
        setPosition(position) { this.options.position = position; }
        setMap(map) { if (!map) this.element.remove(); this.options.map = map; }
      },
      Circle: class {
        constructor(options) { this.options = options; window.locationTest.circles.push(this); }
        setMap(map) { this.options.map = map; }
      },
      convertFrom(input, type, callback) {
        window.locationTest.conversion = { input, type };
        setTimeout(() => callback(window.locationTest.mode === 'conversion-error' ? 'error' : 'complete', { locations: [[119.301, 26.058]] }), 30);
      }
    };
  });
});

for (const width of [390, 1440]) test(`location marker and accuracy at ${width}px`, async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/app/map');
  const button = page.getByRole('button', { name: '定位我的位置' });
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.getByRole('img', { name: '我的位置' })).toBeVisible();
  await expect(page.locator('.map-location-status')).toContainText('精度约 150 米');
  expect(await page.evaluate(() => ({ center: window.locationTest.map.center, conversion: window.locationTest.conversion, radius: window.locationTest.circles[0].options.radius }))).toEqual({ center: [119.301, 26.058], conversion: { input: [119.296531, 26.061473], type: 'gps' }, radius: 150 });
  await button.click();
  await expect(button).toBeEnabled();
  expect(await page.evaluate(() => window.locationTest.markers.length)).toBe(1);
  expect(await page.evaluate(() => window.locationTest.circles[0].options.map)).toBeNull();
  await page.evaluate(() => { window.locationTest.mode = 'denied'; });
  await button.click();
  await expect(page.locator('.map-location-status')).toContainText('定位权限被拒绝');
  await expect(page.locator('.map-location-status')).toContainText('保留上次位置');
  await expect(page.getByRole('img', { name: '我的位置' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('location-marker.png') });
  expect(errors).toEqual([]);
});

test('conversion failure does not move the map or create a misleading marker', async ({ page }) => {
  await page.goto('/app/map');
  await page.evaluate(() => { window.locationTest.mode = 'conversion-error'; });
  await page.getByRole('button', { name: '定位我的位置' }).click();
  await expect(page.locator('.map-location-status')).toContainText('坐标转换失败');
  await expect(page.getByRole('button', { name: '定位我的位置' })).toBeEnabled();
  await expect(page.getByRole('img', { name: '我的位置' })).toHaveCount(0);
  expect(await page.evaluate(() => window.locationTest.map.center)).toBeUndefined();
});

test('late location callback after leaving the map is ignored', async ({ page }) => {
  await page.goto('/app/map');
  await page.evaluate(() => {
    window.AMap.convertFrom = (input, type, callback) => { window.locationTest.finish = callback; };
  });
  await page.getByRole('button', { name: '定位我的位置' }).click();
  await expect.poll(() => page.evaluate(() => typeof window.locationTest.finish)).toBe('function');
  await page.getByRole('button', { name: '地点', exact: true }).first().click();
  await page.evaluate(() => window.locationTest.finish('complete', { locations: [[119.301, 26.058]] }));
  expect(await page.evaluate(() => window.locationTest.markers.length)).toBe(0);
});
