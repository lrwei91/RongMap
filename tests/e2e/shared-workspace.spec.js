const { test, expect } = require('@playwright/test');

function fixture(count = 24) {
  return {
    mode: 'test',
    currentUser: { id: 'admin', name: '小榕', email: 'admin@rongmap.local', username: 'xiaorong', role: 'admin' },
    space: { id: 'space', name: '周末去哪儿', memberCount: 2 },
    members: [{ id: 'admin', name: '小榕', username: 'xiaorong', role: 'admin' }, { id: 'friend', name: '阿福', username: 'afu', role: 'member' }],
    tags: [{ id: 'weekend', name: '周末' }],
    locations: Array.from({ length: count }, (_, index) => ({ id: `loc-${index}`, name: `地点 ${index + 1}`, address: `福州市测试地址 ${index + 1}`, category: index % 2 ? 'food' : 'spot', reason: index === 2 ? '适合周末' : '', latitude: index === 0 ? null : 26.06 + index / 1000, longitude: index === 0 ? null : 119.29 + index / 1000, tags: index % 3 ? [] : [{ id: 'weekend', name: '周末' }], createdBy: index % 2 ? 'admin' : 'friend', createdAt: new Date(Date.now() - index * 3600000).toISOString(), version: 1 })),
    trash: [], trips: [], activity: [], shareLinks: []
  };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture()) }));
});

test('member login only asks for a username', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByRole('heading', { name: '回到亲友共享地图' })).toBeVisible();
  await expect(page.getByLabel('用户名')).toBeVisible();
  await expect(page.getByLabel('邮箱')).toHaveCount(0);
  await expect(page.getByLabel('密码')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.getByText('发送登录链接')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled();
});

test('unregistered username keeps the login form and explains why', async ({ page }) => {
  await page.route('**/api/v2/session', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: '该用户名未注册' }) }));
  await page.goto('/auth/login');
  await page.getByLabel('用户名').fill('nobody');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.inline-notice[role="alert"]', { hasText: '该用户名未注册' })).toBeVisible();
  await expect(page.getByLabel('用户名')).toHaveValue('nobody');
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
  await page.locator('.mobile-tab', { hasText: '路书' }).click();
  await expect(page.getByRole('heading', { name: '旅行路书', exact: true })).toBeVisible();
  await page.locator('.mobile-tab', { hasText: '我的' }).click();
  await page.getByRole('button', { name: '活动记录', exact: true }).click();
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
  await expect(page.getByLabel('地点名称')).toHaveCount(0);
  await expect(address).toHaveValue('福建省福州市鼓楼区北大路1号');
  await expect(page.getByLabel('纬度')).toHaveValue('26.061473');
  await expect(page.getByLabel('经度')).toHaveValue('119.296531');
  await expect(page.getByText('已回填地址和经纬度')).toBeVisible();
  await page.route('**/api/v2/locations', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'new-location', ...route.request().postDataJSON() }) }));
  const saved = page.waitForRequest((request) => request.url().endsWith('/api/v2/locations') && request.method() === 'POST');
  await page.getByRole('button', { name: '保存地点', exact: true }).click();
  expect((await saved).postDataJSON().name).toBe('银芳水煮蛙');
});

test('address search selects the missing store on mobile and clears coordinates when changed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/search', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: '1', pois: [{ id: 'B0M2VZJGUT', name: '明猪平凡烤肉', cityname: '福州市', adname: '仓山区', address: '恩歌城市公寓13A商铺', location: '119.270745,26.029141' }] }) }));
  await page.goto('/app/map');
  await page.locator('.mobile-tab--add').click();
  const name = page.getByRole('combobox', { name: '地址' });
  await name.fill('明猪平凡烤肉');
  await expect(page.getByRole('option', { name: /明猪平凡烤肉/ })).toBeVisible();
  await name.press('Enter');
  await expect(page.getByLabel('地址', { exact: true })).toHaveValue('福州市仓山区恩歌城市公寓13A商铺');
  await expect(page.getByLabel('经度')).toHaveValue('119.270745');
  await expect(page.getByLabel('纬度')).toHaveValue('26.029141');
  await expect(page.locator('.address-suggestions [role="option"]')).toHaveCount(0);
  await name.fill('另一家店');
  await expect(page.getByLabel('经度')).toHaveValue('');
  await expect(page.getByLabel('纬度')).toHaveValue('');
  expect(await page.locator('[role="dialog"]').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('changing search text ignores the previous in-flight response and shows service errors', async ({ page }) => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/search', async (route) => {
    if (route.request().postDataJSON().keywords === '旧店名') {
      await waiting;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pois: [{ id: 'old', name: '过期结果', address: '旧地址' }] }) });
    } else await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: '搜索服务暂时不可用' }) });
  });
  await page.goto('/app/map');
  await page.getByRole('button', { name: '添加地点' }).first().click();
  const request = page.waitForRequest('**/api/search');
  await page.getByLabel('地址', { exact: true }).fill('旧店名');
  await request;
  await page.getByLabel('地址', { exact: true }).fill('新地址');
  await expect(page.getByRole('alert')).toContainText('地点搜索暂时不可用');
  const staleResponse = page.waitForResponse((response) => response.url().endsWith('/api/search') && response.status() === 200);
  release();
  await staleResponse;
  await expect(page.locator('.address-suggestions [role="option"]')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('地点搜索暂时不可用');
  await page.route('**/api/v2/locations', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'manual-location', ...route.request().postDataJSON() }) }));
  const saved = page.waitForRequest((request) => request.url().endsWith('/api/v2/locations') && request.method() === 'POST');
  await page.getByRole('button', { name: '保存地点', exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({ name: '新地址', address: '新地址' });

});

test('member registration shows progress, persists the username and blocks duplicates', async ({ page }) => {
  await page.unroute('**/api/v2/bootstrap');
  const data = fixture();
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await page.route('**/api/v2/members', async (route) => {
    const { username, name } = route.request().postDataJSON();
    const member = { id: 'new', username, name, email: `${username}@rongmap.local`, role: 'member', status: 'active', createdAt: new Date().toISOString() };
    data.members.push(member);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(member) });
  });
  await page.goto('/app/settings');
  await page.getByRole('textbox', { name: '成员用户名' }).fill('xiaomei');
  await page.getByRole('textbox', { name: '成员姓名' }).fill('小美');
  await page.getByRole('button', { name: '注册成员' }).click();
  await expect(page.getByText('已注册 xiaomei，对方现在就能用该用户名登录。')).toBeVisible();
  await expect(page.getByText('用户名 xiaomei')).toBeVisible();
  await page.getByRole('textbox', { name: '成员用户名' }).fill('xiaomei');
  await expect(page.getByRole('button', { name: '已注册' })).toBeDisabled();
  await expect(page.getByText('该用户名已经是空间成员。')).toBeVisible();
});

test('member registration failure remains visible and keeps the username', async ({ page }) => {
  await page.route('**/api/v2/members', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '该用户名已被注册' }) }));
  await page.goto('/app/settings');
  const input = page.getByRole('textbox', { name: '成员用户名' });
  await input.fill('xiaoli');
  await page.getByRole('button', { name: '注册成员' }).click();
  await expect(page.locator('.inline-notice[role="alert"]', { hasText: '该用户名已被注册' })).toBeVisible();
  await expect(input).toHaveValue('xiaoli');
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

function roadbookFixture() {
  return { id: 'road-1', name: '福州两日慢游', description: '亲友周末', version: 1, startDate: '2026-10-03', days: [{ id: 'day-1', dayIndex: 1, date: '2026-10-03', title: '老城慢游', items: [{ id: 'stop-1', name: '三坊七巷', address: '南后街', longitude: 119.296, latitude: 26.08, note: '午后散步' }, { id: 'stop-2', name: '西湖公园', address: '湖滨路', longitude: 119.29, latitude: 26.09 }] }], roadbook: { mode: 'car', origin: '福州', travelers: 2, preferences: '慢节奏', budget: 200, tickets: [], clothing: '带雨具', tips: '提前预约' } };
}
async function mockRoadbook(page) {
  let trip = roadbookFixture();
  const data = fixture();
  data.trips = [{ ...trip, dayCount: 1, itemCount: 2 }];
  data.activity = [{ id: 'activity-1', actorId: 'friend', actorName: '阿福', action: 'trip_created', targetName: trip.name, createdAt: '2026-10-03T03:00:00Z' }];
  await page.route('**/api/v2/bootstrap', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  await page.route('**/api/v2/trips?id=road-1', async (route) => {
    if (route.request().method() === 'PUT') trip = { ...route.request().postDataJSON(), version: trip.version + 1 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(trip) });
  });
  await page.route('**/api/v2/roadbook', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ queriedAt: '2026-10-03T03:00:00Z', source: '高德地图 Web 服务', complete: true, segments: [{ index: 1, from: '三坊七巷', to: '西湖公园', km: 2.5, hours: 0.2 }], weather: [{ city: '福州', reportTime: '2026-10-03 10:00', casts: [{ date: '2026-10-03', dayweather: '晴', nightweather: '多云', nighttemp: '22', daytemp: '29' }] }], warnings: [] }) }));
}

test('roadbook saves costs, reloads, inspects live data and exports a standalone page', async ({ page }) => {
  await mockRoadbook(page);
  await page.goto('/app/roadbook');
  await page.getByRole('button', { name: /福州两日慢游/ }).click();
  await expect(page.getByRole('button', { name: '规划草案' })).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: '预算与提醒' }).click();
  await page.getByRole('button', { name: '添加花费项目' }).click();
  await page.getByLabel('项目名称').fill('门票');
  await page.getByLabel('金额（元/人）').fill('50');
  await page.getByLabel('来源与核实日期').fill('景区官网 2026-10-03');
  await page.getByRole('button', { name: '完整路书' }).click();
  await expect(page.getByRole('button', { name: '导出路书网页' })).toBeDisabled();
  await page.getByRole('button', { name: '保存路书' }).click();
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: '路书已保存' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '预算与提醒' }).click();
  await expect(page.getByLabel('金额（元/人）')).toHaveValue('50');
  await page.getByRole('button', { name: '完整路书' }).click();
  await page.getByRole('button', { name: '核实当天路线与天气' }).click();
  await expect(page.getByText('2026-10-03 · 晴 / 多云 · 22–29℃')).toBeVisible();
  await expect(page.getByText(/当天路段合计：2.5 km/)).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出路书网页' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('福州两日慢游-路书.html');
  await expect(page.getByRole('link', { name: '高德导航至本站' })).toHaveAttribute('href', /uri.amap.com\/navigation/);
});

test('roadbook preserves edits on conflict and keeps activity filters in My', async ({ page }) => {
  await mockRoadbook(page);
  await page.route('**/api/v2/trips?id=road-1', async (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '版本冲突' }) }) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roadbookFixture()) }));
  await page.goto('/app/roadbook/road-1');
  await page.getByRole('button', { name: '预算与提醒' }).click();
  await page.getByLabel('注意事项').fill('保留我的修改');
  await page.getByRole('button', { name: '保存路书' }).click();
  await expect(page.getByText('其他成员已更新行程，请载入最新版本后重新应用修改。')).toBeVisible();
  await expect(page.getByLabel('注意事项')).toHaveValue('保留我的修改');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('.nav-item', { hasText: '我的' }).click();
  await expect(page.getByLabel('注意事项')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.nav-item', { hasText: '我的' }).click();
  await page.getByRole('button', { name: '活动记录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '福州两日慢游' })).toBeVisible();
  await page.getByLabel('按成员筛选').selectOption('admin');
  await expect(page.getByText('暂无匹配活动')).toBeVisible();
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`roadbook and My fit ${width}px without horizontal overflow`, async ({ page }) => {
    await mockRoadbook(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('/app/roadbook/road-1');
    await expect(page.getByRole('heading', { name: '福州两日慢游' })).toBeVisible();
    await expect(page.locator('.roadbook-steps li')).toHaveCount(4);
    await expect(page.getByRole('button', { name: '规划草案' })).toHaveAttribute('aria-current', 'step');
    if (width === 390) await page.screenshot({ path: 'artifacts/roadbook-mobile.png', fullPage: true });
    if (width === 1440) await page.screenshot({ path: 'artifacts/roadbook-desktop.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.goto('/app/settings');
    await page.getByRole('button', { name: '活动记录', exact: true }).click();
    await expect(page.getByLabel('按成员筛选')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
}

test('public trip sharing includes the saved roadbook without edit controls', async ({ page }) => {
  await page.route('**/api/v2/public-share?token=roadbook-test', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ type: 'trip', trip: roadbookFixture() }) }));
  await page.goto('/share/roadbook-test');
  await expect(page.getByText('带雨具')).toBeVisible();
  await expect(page.getByText('提前预约')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存路书' })).toHaveCount(0);
});

test('roadbook supports enlarged text and mobile landscape without script errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockRoadbook(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/app/roadbook/road-1');
  await page.getByRole('button', { name: '预算与提醒' }).click();
  await expect(page.getByLabel('注意事项')).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.getByLabel('注意事项').fill('长文本'.repeat(200));
  await page.getByRole('button', { name: '保存路书' }).click();
  await page.getByRole('button', { name: '完整路书' }).click();
  await expect(page.getByRole('button', { name: '导出路书网页' })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('AI roadbook previews selected locations, applies a draft and saves the generated days', async ({ page }) => {
  await mockRoadbook(page);
  let requestBody;
  let saves = 0;
  await page.route('**/api/v2/trips?id=road-1', (route) => {
    if (route.request().method() === 'PUT') {
      saves += 1;
      const saved = { ...route.request().postDataJSON(), version: 2 };
      expect(saved.days).toHaveLength(2);
      expect(saved.days[1].items[0].name).toBe('西湖公园');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(saved) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roadbookFixture()) });
  });
  await page.route('**/api/v2/roadbook-ai', async (route) => {
    requestBody = route.request().postDataJSON();
    const original = roadbookFixture();
    const proposal = { ...original, roadbook: { ...original.roadbook, clothing: 'AI 衣物建议' }, days: [{ dayIndex: 1, title: '老城', items: [original.days[0].items[0]] }, { dayIndex: 2, title: '湖畔', items: [original.days[0].items[1]] }] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trip: proposal, warnings: ['待核实'] }) });
  });
  await page.goto('/app/roadbook/road-1');
  await page.getByLabel('旅行需求').fill('带长辈两日慢游');
  await page.getByLabel('规划天数').fill('2');
  await page.getByRole('button', { name: '生成路书草案' }).click();
  await expect(page.getByRole('heading', { name: 'AI 草案预览' })).toBeVisible();
  expect(saves).toBe(0);
  expect(requestBody.requirements).toBe('带长辈两日慢游');
  expect(requestBody.dayCount).toBe(2);
  await page.getByRole('button', { name: '应用到路书草稿' }).click();
  await page.getByRole('button', { name: '预算与提醒' }).click();
  await expect(page.getByLabel('穿着建议')).toHaveValue('AI 衣物建议');
  await expect(page.getByRole('button', { name: '保存路书' })).toBeEnabled();
  expect(saves).toBe(0);
  await page.getByRole('button', { name: '保存路书' }).click();
  await expect(page.getByRole('button', { name: '已保存' })).toBeVisible();
  expect(saves).toBe(1);
});

test('AI failure preserves edits and allows retry with explicitly selected library places', async ({ page }) => {
  await mockRoadbook(page);
  let requestBody;
  await page.route('**/api/v2/roadbook-ai', (route) => { requestBody = route.request().postDataJSON(); return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'AI服务繁忙，请稍后重试' }) }); });
  await page.goto('/app/roadbook/road-1');
  await page.getByRole('button', { name: '预算与提醒' }).click();
  await page.getByLabel('注意事项').fill('保留已有草稿');
  await page.getByRole('button', { name: '规划草案' }).click();
  await page.getByLabel('旅行需求').fill('周末游');
  await page.getByLabel('地点来源').selectOption('library');
  await page.getByRole('button', { name: '生成路书草案' }).click();
  await expect(page.getByRole('alert')).toHaveText('AI服务繁忙，请稍后重试');
  await page.getByRole('button', { name: '预算与提醒' }).click();
  await expect(page.getByLabel('注意事项')).toHaveValue('保留已有草稿');
  await page.getByRole('button', { name: '规划草案' }).click();
  await expect(page.getByRole('button', { name: '生成路书草案' })).toBeEnabled();
  expect(requestBody.locationIds).toHaveLength(12);
});
