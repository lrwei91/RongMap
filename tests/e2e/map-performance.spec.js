const { test, expect } = require('@playwright/test');

test('unrelated selection and active marker changes avoid bulk SDK updates', async ({ page }) => {
  await page.addInitScript(() => {
    window.mapPerformance = { created: 0, content: 0, position: 0, zIndex: 0, markers: [] };
    window.AMap = {
      Map: class { setZoomAndCenter() {} destroy() {} },
      Marker: class {
        constructor(options) { this.options = options; window.mapPerformance.created++; window.mapPerformance.markers.push(this); }
        on(event, callback) { this[event] = callback; }
        setContent(value) { this.options.content = value; window.mapPerformance.content++; }
        setPosition() { window.mapPerformance.position++; }
        setzIndex() { window.mapPerformance.zIndex++; }
        setMap() {}
      }
    };
  });
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ json: {
    currentUser: { id: 'test', name: '测试成员', role: 'member' }, space: { id: 'test', name: '性能测试' },
    members: [], tags: [], trash: [], trips: [], activity: [], shareLinks: [],
    locations: Array.from({ length: 1000 }, (_, i) => ({ id: `loc-${i}`, name: `地点 ${i}`, category: 'food', address: '福州市', latitude: 26.06 + i / 100000, longitude: 119.29 + i / 100000, createdAt: '2026-10-01T00:00:00Z' }))
  } }));
  await page.goto('/app/map');
  await expect.poll(() => page.evaluate(() => window.mapPerformance.created)).toBe(1000);
  await page.evaluate(() => Object.assign(window.mapPerformance, { content: 0, position: 0, zIndex: 0 }));
  await page.getByRole('checkbox', { name: '选择 地点 0', exact: true }).check();
  const unrelated = await page.evaluate(() => ({ content: window.mapPerformance.content, position: window.mapPerformance.position, zIndex: window.mapPerformance.zIndex }));
  await page.evaluate(() => window.mapPerformance.markers[0].click());
  await expect(page.getByRole('dialog')).toBeVisible();
  const activated = await page.evaluate(() => ({ content: window.mapPerformance.content, position: window.mapPerformance.position, zIndex: window.mapPerformance.zIndex }));
  console.log(JSON.stringify({ unrelated, activated }));
  expect(unrelated).toEqual({ content: 0, position: 0, zIndex: 0 });
  expect(activated).toEqual({ content: 1, position: 0, zIndex: 1 });
  await page.getByRole('button', { name: '关闭详情' }).click();
  expect(await page.evaluate(() => window.mapPerformance.content)).toBe(2);
});

test('public trip selection reuses routes and changes the highlighted day', async ({ page }) => {
  await page.addInitScript(() => {
    window.routePerformance = { lines: [], markers: [] };
    window.AMap = {
      Map: class { setZoomAndCenter() {} destroy() {} },
      Marker: class {
        constructor(options) { this.options = options; window.routePerformance.markers.push(this); }
        on(event, callback) { this[event] = callback; }
        setContent() {} setPosition() {} setzIndex() {} setMap() {}
      },
      Polyline: class {
        constructor(options) { this.options = options; window.routePerformance.lines.push(this); }
        setMap(map) { this.options.map = map; }
      }
    };
  });
  await page.route('**/api/v2/public-share?token=performance', (route) => route.fulfill({ json: {
    type: 'trip', trip: { id: 'trip', name: '性能测试行程', days: [1, 2].map((dayIndex) => ({
      dayIndex, items: [1, 2].map((index) => ({ id: `${dayIndex}-${index}`, name: `第${dayIndex}天地点${index}`, longitude: 119.29 + index / 100, latitude: 26.06 + dayIndex / 100 }))
    })) }
  } }));
  await page.goto('/share/performance');
  await expect.poll(() => page.evaluate(() => window.routePerformance.lines.length)).toBe(2);
  await page.evaluate(() => window.routePerformance.markers[0].click());
  await expect(page.locator('.public-location.is-active')).toContainText('第1天地点1');
  expect(await page.evaluate(() => window.routePerformance.lines.length)).toBe(2);
  await page.evaluate(() => window.routePerformance.markers[2].click());
  await expect(page.locator('.public-location.is-active')).toContainText('第2天地点1');
  await expect.poll(() => page.evaluate(() => window.routePerformance.lines.length)).toBe(4);
  expect(await page.evaluate(() => window.routePerformance.lines.slice(-2).map((line) => line.options.strokeWeight))).toEqual([3, 6]);
});
