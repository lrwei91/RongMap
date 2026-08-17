const { test, expect } = require('@playwright/test');

function fixture(count = 24) {
  return {
    mode: 'test',
    currentUser: { id: 'admin', name: '小榕', email: 'admin@example.com', role: 'admin' },
    space: { id: 'space', name: '周末去哪儿', memberCount: 2 },
    members: [{ id: 'admin', name: '小榕', role: 'admin' }, { id: 'friend', name: '阿福', role: 'member' }],
    tags: [{ id: 'weekend', name: '周末' }],
    locations: Array.from({ length: count }, (_, index) => ({ id: `loc-${index}`, name: `地点 ${index + 1}`, address: `福州市测试地址 ${index + 1}`, category: index % 2 ? 'food' : 'spot', reason: index === 2 ? '适合周末' : '', latitude: index === 0 ? null : 26.06 + index / 1000, longitude: index === 0 ? null : 119.29 + index / 1000, tags: index % 3 ? [] : [{ id: 'weekend', name: '周末' }], createdBy: index % 2 ? 'admin' : 'friend', createdAt: new Date(Date.now() - index * 3600000).toISOString(), version: 1 })),
    trash: [], trips: [], activity: [], shareLinks: []
  };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture()) }));
});

test('desktop keeps the map fixed while the list grows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/map');
  await expect(page.getByRole('heading', { name: '地图工作台' })).toBeVisible();
  const list = page.locator('.map-workspace .compact-list');
  const map = page.locator('.map-card');
  const before = await page.locator('.map-card').boundingBox();
  const scrollState = await page.evaluate(() => ({
    pageOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    bodyOverflow: document.body.scrollHeight - document.body.clientHeight
  }));
  expect(scrollState.pageOverflow).toBe(0);
  expect(scrollState.bodyOverflow).toBe(0);
  await list.hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const after = await map.boundingBox();
  expect(after.height).toBe(before.height);
  expect(after.y).toBe(before.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('location context menu renders above the following card', async ({ page }) => {
  await page.goto('/app/map');
  const firstCard = page.locator('.location-card').first();
  const nextCard = page.locator('.location-card').nth(1);
  await firstCard.getByRole('button', { name: /打开 .* 操作菜单/ }).click();
  const menu = firstCard.locator('.context-menu__popover');
  await expect(menu).toBeVisible();
  const [menuBox, nextBox] = await Promise.all([menu.boundingBox(), nextCard.boundingBox()]);
  expect(menuBox.y + menuBox.height).toBeGreaterThan(nextBox.y);
  expect(await menu.evaluate((element) => {
    const point = element.getBoundingClientRect();
    return document.elementFromPoint(point.left + 20, Math.min(point.bottom - 8, window.innerHeight - 1))?.closest('.context-menu__popover') === element;
  })).toBe(true);
});

test('search, filter and mobile navigation remain operable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/locations');
  await page.getByRole('searchbox', { name: '搜索地点' }).fill('周末');
  await expect(page.locator('.location-card__copy > strong', { hasText: '地点 3' })).toBeVisible();
  await page.locator('.mobile-tab', { hasText: '活动' }).click();
  await expect(page.getByRole('heading', { name: '活动记录' })).toBeVisible();
  await page.locator('.mobile-tab--add').click();
  await expect(page.getByRole('dialog', { name: '添加地点' })).toBeVisible();
});

test('import wizard exposes all five steps', async ({ page }) => {
  await page.goto('/app/map');
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '批量导入地点' })).toBeVisible();
  await expect(page.getByText('上传文件')).toBeVisible();
  await expect(page.getByText('重复预览')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '批量导入地点' })).toBeHidden();
});

test('add location address search fills the selected POI and coordinates', async ({ page }) => {
  await page.route('**/api/search', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ pois: [{ id: 'poi-1', name: '银芳水煮蛙', pname: '福建省', cityname: '福州市', adname: '鼓楼区', address: '北大路1号', location: '119.296531,26.061473', type: '餐饮服务' }] })
  }));
  await page.goto('/app/map');
  await page.getByRole('button', { name: '添加地点' }).first().click();
  const address = page.getByRole('combobox', { name: '地址' });
  await address.fill('银芳');
  await expect(page.getByRole('option', { name: /银芳水煮蛙/ })).toBeVisible();
  await address.press('Enter');
  await expect(page.getByLabel('地点名称')).toHaveValue('银芳水煮蛙');
  await expect(address).toHaveValue('福建省福州市鼓楼区北大路1号');
  await expect(page.getByLabel('纬度')).toHaveValue('26.061473');
  await expect(page.getByLabel('经度')).toHaveValue('119.296531');
  await expect(page.getByText('已回填地址和经纬度')).toBeVisible();
});

test('member invitation shows progress, persists pending status and blocks duplicates', async ({ page }) => {
  await page.unroute('**/api/v2/bootstrap');
  const data = fixture();
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await page.route('**/api/v2/members', async (route) => {
    const email = route.request().postDataJSON().email;
    const member = { id: 'pending', name: email.split('@')[0], email, role: 'member', status: 'invited', createdAt: new Date().toISOString() };
    data.members.push(member);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(member) });
  });
  await page.goto('/app/settings');
  await page.getByRole('textbox', { name: '受邀成员邮箱' }).fill('friend@example.com');
  await page.getByRole('button', { name: '发送邀请' }).click();
  await expect(page.getByText('已向 friend@example.com 发送邀请，等待对方接受。')).toBeVisible();
  await expect(page.getByText('邀请待接受')).toBeVisible();
  await expect(page.getByText(/friend@example.com · 邀请已发送/)).toBeVisible();
  await page.getByRole('textbox', { name: '受邀成员邮箱' }).fill('friend@example.com');
  await expect(page.getByRole('button', { name: '已邀请' })).toBeDisabled();
  await expect(page.getByText('该邮箱已发送过邀请，正在等待对方加入。')).toBeVisible();
});

test('member invitation failure remains visible and keeps the email', async ({ page }) => {
  await page.route('**/api/v2/members', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: '邮件发送过于频繁，请稍后再试' }) }));
  await page.goto('/app/settings');
  const input = page.getByRole('textbox', { name: '受邀成员邮箱' });
  await input.fill('later@example.com');
  await page.getByRole('button', { name: '发送邀请' }).click();
  await expect(page.locator('.inline-notice[role="alert"]', { hasText: '邮件发送过于频繁，请稍后再试' })).toBeVisible();
  await expect(input).toHaveValue('later@example.com');
});

test('creates, edits, optimizes and shares a trip from selected locations', async ({ page }) => {
  await page.unroute('**/api/v2/bootstrap');
  const data = fixture();
  let trip;
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await page.route('**/api/v2/trips**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      trip = { id: 'trip-1', ...body, version: 1, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      data.trips = [{ id: trip.id, name: trip.name, description: trip.description, startDate: trip.startDate, version: 1, dayCount: trip.days.length, itemCount: trip.days.flatMap((day) => day.items).length }];
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(trip) });
    }
    if (request.method() === 'GET' && url.searchParams.get('id')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(trip) });
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      if (body.action === 'optimize') {
        trip = { ...trip, version: trip.version + 1, optimization: [{ dayIndex: body.dayIndex, beforeKm: 3.2, afterKm: 2.4, skipped: 0, improved: true }] };
      } else trip = { ...body, id: trip.id, version: trip.version + 1, status: 'draft', updatedAt: new Date().toISOString() };
      data.trips[0] = { ...data.trips[0], version: trip.version, dayCount: trip.days.length, itemCount: trip.days.flatMap((day) => day.items).length };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(trip) });
    }
    return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: '方法不允许' }) });
  });
  await page.route('**/api/v2/share-links', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'share-trip', scope: 'trip', tripId: 'trip-1', token: 'TRIP_TOKEN' }) }));

  await page.goto('/app/locations');
  await page.locator('.location-card .selection-check input').nth(1).check();
  await page.locator('.location-card .selection-check input').nth(2).check();
  await page.getByRole('button', { name: '创建行程' }).click();
  await expect(page.getByRole('dialog', { name: '创建行程' })).toBeVisible();
  await page.getByLabel('行程名称').fill('福州周末路线');
  await page.getByRole('button', { name: '创建并编排行程' }).click();
  await expect(page).toHaveURL(/\/app\/trips\/trip-1/);
  await expect(page.getByLabel('行程名称')).toHaveValue('福州周末路线');
  await expect(page.locator('.trip-item')).toHaveCount(2);

  await page.getByRole('button', { name: '增加一天' }).click();
  await page.getByRole('button', { name: /第 1 天/ }).click();
  await page.locator('.trip-item').first().getByRole('button', { name: '后一天' }).click();
  await page.getByRole('button', { name: '保存行程' }).click();
  await expect(page.getByRole('button', { name: '已保存' })).toBeDisabled();
  await page.getByRole('button', { name: /第 2 天/ }).click();
  await page.getByRole('button', { name: '优化当天路线' }).click();
  await expect(page.getByText(/路线已从 3.2 km 优化到 2.4 km/)).toBeVisible();
  await page.getByRole('button', { name: '创建只读链接' }).click();
  await expect(page.getByText('行程只读链接已创建并复制')).toBeVisible();
});

test('renders a trip-scoped public share without edit actions', async ({ page }) => {
  const trip = {
    id: 'trip-public', name: '福州两日游', startDate: '2026-08-20', version: 2,
    days: [{ id: 'day-1', dayIndex: 1, date: '2026-08-20', title: '老城', items: [
      { id: 'item-1', name: '三坊七巷', address: '鼓楼区南后街', category: 'spot', longitude: 119.296, latitude: 26.082, startTime: '09:00', endTime: '11:00' }
    ] }]
  };
  await page.route('**/api/v2/public-share?token=TRIP_TOKEN', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'trip', space: { id: 'space', name: '周末去哪儿' }, trip }) }));
  await page.goto('/share/TRIP_TOKEN');
  await expect(page.getByRole('heading', { name: '福州两日游' })).toBeVisible();
  await expect(page.getByText('第 1 天')).toBeVisible();
  await expect(page.getByRole('button', { name: /三坊七巷/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存行程' })).toHaveCount(0);
  await expect(page.getByText('只读', { exact: true })).toBeVisible();
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`viewport ${width}px has no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto('/app/map');
    await expect(page.locator('.map-card')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
}

test('1000 locations filter within the interaction budget', async ({ page }) => {
  await page.unroute('**/api/v2/bootstrap');
  const large = fixture(1000);
  large.locations = large.locations.map((item, index) => ({ ...item, name: index % 10 === 0 ? `周末地点 ${index}` : `普通地点 ${index}` }));
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(large) }));
  await page.goto('/app/locations');
  const result = await page.evaluate(async () => {
    const input = document.querySelector('input[aria-label="搜索地点"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const started = performance.now();
    setter.call(input, '周末');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { duration: performance.now() - started, cards: document.querySelectorAll('.location-card').length };
  });
  expect(result.duration).toBeLessThan(100);
  expect(result.cards).toBeLessThanOrEqual(80);
});
