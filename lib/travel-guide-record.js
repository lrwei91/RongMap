const fail = (message) => Object.assign(new Error(message), { status: 400 });
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
function sourceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    url.search = ''; url.hash = '';
    return url.href.slice(0, 500);
  } catch { return ''; }
}
function normalizeRequest(input = {}) {
  const destination = text(input.destination, 60);
  if (!destination) throw fail('请填写目的地城市');
  const dayCount = Number(input.dayCount);
  const travelers = Number(input.travelers);
  const budget = input.budget === '' || input.budget == null ? null : Number(input.budget);
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 14) throw fail('攻略天数为 1–14 天');
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 30) throw fail('同行人数为 1–30 人');
  if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > 1000000)) throw fail('请填写有效的人均预算');
  const startDate = text(input.startDate, 10);
  if (startDate && (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(Date.parse(startDate)) || new Date(startDate).toISOString().slice(0, 10) !== startDate)) throw fail('出发日期无效');
  return { destination, dayCount, travelers, budget, startDate, mode: ['car', 'transit', 'walk'].includes(input.mode) ? input.mode : 'car', preferences: text(input.preferences, 800), constraints: text(input.constraints, 800), hotel: text(input.hotel, 120), origin: text(input.origin, 120) };
}
function normalizeSources(input) {
  if (!Array.isArray(input) || input.length > 8) throw fail('最多补充 8 条攻略来源');
  return input.map((source, index) => {
    const url = sourceUrl(source?.url);
    if (!url) throw fail('攻略来源须填写有效的 HTTPS 链接');
    return { id: `reference-${index + 1}`, platform: 'reference', name: text(source.title || source.name, 100) || '补充攻略', url, excerpt: text(source.excerpt, 1000), status: 'user_provided' };
  });
}
function normalizeGuide(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('旅行攻略格式不正确');
  const list = (value, limit, map) => Array.isArray(value) ? value.slice(0, limit).map(map) : [];
  return {
    request: normalizeRequest(input.request), generatedAt: text(input.generatedAt, 40),
    overview: text(input.overview, 1000), rainPlan: text(input.rainPlan, 1000), stayAdvice: text(input.stayAdvice, 1000),
    pitfalls: list(input.pitfalls, 12, (item) => text(item, 300)).filter(Boolean),
    bookingChecklist: list(input.bookingChecklist, 12, (item) => text(item, 300)).filter(Boolean),
    sources: list(input.sources, 50, (source) => ({ id: text(source.id, 120), platform: text(source.platform, 40), name: text(source.name, 120), url: sourceUrl(source.url), excerpt: text(source.excerpt, 1000), status: ['queried', 'pending', 'not_configured', 'user_provided', 'failed'].includes(source.status) ? source.status : 'user_provided', checkedAt: text(source.checkedAt, 40) })),
    places: list(input.places, 24, (poi) => ({ sourceId: text(poi.sourceId, 80), name: text(poi.name, 120), address: text(poi.address, 240), category: ['spot', 'food', 'cafe_bar'].includes(poi.category) ? poi.category : 'spot', city: text(poi.city, 80), longitude: Number(poi.longitude), latitude: Number(poi.latitude), rating: finite(poi.rating), averageCost: finite(poi.averageCost), openingHours: text(poi.openingHours, 240), fetchedAt: text(poi.fetchedAt, 40) }))
  };
}
function finite(value) { return value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value); }
module.exports = { normalizeRequest, normalizeSources, normalizeGuide, sourceUrl };
