const { requestAmap } = require('./amap');
const { isFiniteCoordinateValue } = require('./location-coordinates');

const text = (value, limit = 1000) => String(value ?? '').trim().slice(0, limit);
function normalizeRoadbook(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('路书格式不正确'), { status: 400 });
  const number = (value, max) => {
    if (value === '' || value == null) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > max) throw Object.assign(new Error('预算或人数超出有效范围'), { status: 400 });
    return n;
  };
  if (input.tickets != null && !Array.isArray(input.tickets)) throw Object.assign(new Error('花费项目格式不正确'), { status: 400 });
  if ((input.tickets || []).length > 100) throw Object.assign(new Error('最多填写100项花费'), { status: 400 });
  // 人数必须显式合法：0 或负数是填写错误，静默改成 1 会让预算人均口径失真。
  const travelers = number(input.travelers, 100);
  if (travelers !== null && travelers < 1) throw Object.assign(new Error('出行人数必须至少为 1'), { status: 400 });
  return {
    aiGenerated: input.aiGenerated === true,
    mode: ['car', 'transit', 'walk'].includes(input.mode) ? input.mode : 'car',
    origin: text(input.origin, 120), travelers: Math.max(1, Math.floor(travelers ?? 1)),
    preferences: text(input.preferences), budget: number(input.budget, 1000000),
    clothing: text(input.clothing, 2000), tips: text(input.tips, 3000),
    tickets: (Array.isArray(input.tickets) ? input.tickets : []).map((ticket) => ({
      name: text(ticket.name, 120), price: number(ticket.price, 1000000),
      reservation: text(ticket.reservation, 240), source: text(ticket.source, 500)
    }))
  };
}
const located = (item) => isFiniteCoordinateValue(item?.latitude) && isFiniteCoordinateValue(item?.longitude) && Math.abs(Number(item.latitude)) <= 90 && Math.abs(Number(item.longitude)) <= 180;
const coordinate = (item) => `${Number(item.longitude)},${Number(item.latitude)}`;
async function amap(path, params, request) {
  const result = await request(path, params);
  if (result.status !== '1') throw new Error('高德查询未成功，请稍后重试或检查服务权限');
  return result;
}

// Read a saved trip on the server; never accept coordinates or foreign trip data from the client.
async function inspectDay(trip, dayIndex, request = requestAmap) {
  const day = trip.days.find((item) => item.dayIndex === dayIndex);
  if (!day) throw Object.assign(new Error('未找到当天安排'), { status: 400 });
  if (day.items.length > 25) throw Object.assign(new Error('单日核实最多支持25个地点，请拆分行程'), { status: 400 });
  const queriedAt = new Date().toISOString();
  const segments = [];
  const warnings = [];
  const weather = [];
  const cities = new Set();
  // Limited batches keep provider concurrency and serverless work bounded.
  for (let start = 0; start < day.items.length; start += 4) {
    await Promise.all(day.items.slice(start, start + 4).map(async (item, offset) => {
      const index = start + offset;
      if (!located(item)) { warnings.push(`${item.name}未定位，天气及相邻路段未核实`); return; }
      if (index > 0 && located(day.items[index - 1]) && (trip.roadbook?.mode || 'car') === 'car') {
        const previous = day.items[index - 1];
        try {
          const data = await amap('/v3/direction/driving', { origin: coordinate(previous), destination: coordinate(item), extensions: 'base' }, request);
          const path = data.route?.paths?.[0];
          if (!path || !Number.isFinite(Number(path.distance)) || Number(path.distance) < 0 || !Number.isFinite(Number(path.duration)) || Number(path.duration) < 0) throw new Error('路线暂无数据');
          segments.push({ index, from: previous.name, to: item.name, km: Number(path.distance) / 1000, hours: Number(path.duration) / 3600 });
        } catch { warnings.push(`${previous.name} → ${item.name}：驾车路线核实失败`); }
      }
      try {
        const geo = await amap('/v3/geocode/regeo', { location: coordinate(item), extensions: 'base' }, request);
        const city = geo.regeocode?.addressComponent?.adcode;
        if (!city || cities.has(city)) return;
        cities.add(city);
        const data = await amap('/v3/weather/weatherInfo', { city, extensions: 'all' }, request);
        const forecast = data.forecasts?.[0];
        if (!forecast) throw new Error('天气暂无数据');
        weather.push({ city: forecast.city, reportTime: forecast.reporttime, casts: forecast.casts || [] });
      } catch { warnings.push(`${item.name}：天气查询失败`); }
    }));
  }
  segments.sort((a, b) => a.index - b.index);
  const hours = segments.reduce((sum, segment) => sum + segment.hours, 0);
  if (hours > 8) warnings.push('当天驾驶超过8小时，建议拆分行程并预留休息时间');
  else if (hours > 5) warnings.push('当天驾驶超过5小时，请减少游玩安排并预留休息时间');
  if (trip.roadbook?.mode && trip.roadbook.mode !== 'car') warnings.push('当前为非自驾行程，班次、换乘与步行时长需自行核实');
  return { queriedAt, source: '高德地图 Web 服务', dayIndex, segments, weather, warnings, complete: segments.length === Math.max(0, day.items.length - 1) && day.items.every(located) && (trip.roadbook?.mode || 'car') === 'car' };
}
module.exports = { normalizeRoadbook, inspectDay };
