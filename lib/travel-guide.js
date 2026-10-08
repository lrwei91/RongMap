const crypto = require('crypto');
const { sourceSummary, querySource } = require('./travel-sources');
const { requestAmap } = require('./amap');
const { completeMessages, buildMessages, validatePlan } = require('./roadbook-ai');
const { normalizeRequest, normalizeSources, normalizeGuide } = require('./travel-guide-record');
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const text = (value) => typeof value === 'string' ? value.trim() : '';
const finite = (value) => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);

function signingKey() {
  if (!process.env.AMAP_WEB_SERVICE_KEY) throw fail('高德旅行搜索服务尚未配置', 503);
  return crypto.createHmac('sha256', process.env.AMAP_WEB_SERVICE_KEY).update('rongmap:travel-research:v1').digest();
}
function subject(identity) {
  if (!identity?.spaceId || !identity?.user?.id) throw fail('登录已失效，请重新登录', 401);
  return JSON.stringify([identity.spaceId, identity.user.id]);
}
// 加密封装来源工具所需的短期访问字段；浏览器无法读取，且不持久化到攻略。
function signResearch(payload, identity) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', signingKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify({ ...payload, subject: subject(identity), expires: Date.now() + 30 * 60000 }), 'utf8'), cipher.final()]);
  return [iv, data, cipher.getAuthTag()].map((part) => part.toString('base64url')).join('.');
}
function readResearch(token, identity) {
  if (typeof token !== 'string' || token.length > 120000) throw fail('请重新搜集候选地点', 400);
  let payload;
  try {
    const parts = token.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (parts.length !== 3 || parts[0].length !== 12 || parts[2].length !== 16) throw new Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', signingKey(), parts[0]);
    decipher.setAuthTag(parts[2]);
    payload = JSON.parse(Buffer.concat([decipher.update(parts[1]), decipher.final()]).toString());
  } catch { throw fail('候选地点校验失败，请重新搜集', 400); }
  if (payload.subject !== subject(identity)) throw fail('候选地点不属于当前用户或空间', 403);
  if (!Number.isFinite(payload.expires) || payload.expires < Date.now()) throw fail('候选地点已过期，请重新搜集', 400);
  return payload;
}
function normalizePlace(poi, fetchedAt) {
  const parts = text(poi.location).split(',');
  const [longitude, latitude] = parts.map(Number);
  if (!text(poi.id) || !text(poi.name) || parts.length !== 2 || parts.some((part) => !part.trim()) || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  const business = poi.business || poi.biz_ext || {};
  return {
    sourceId: poi.id, name: poi.name, address: [text(poi.cityname), text(poi.adname), text(poi.address)].filter(Boolean).join(''),
    city: text(poi.cityname), longitude, latitude, category: text(poi.typecode).startsWith('05') ? (/^050[56]/.test(poi.typecode) ? 'cafe_bar' : 'food') : 'spot',
    rating: finite(business.rating), averageCost: finite(business.cost), openingHours: text(business.opentime_week || business.opening_time), fetchedAt
  };
}
async function collectResearch(input, identity, query = requestAmap) {
  const request = normalizeRequest(input);
  const references = normalizeSources(input.sources || []);
  const geo = await query('/v3/geocode/geo', { address: request.destination });
  const adcode = text(geo.geocodes?.[0]?.adcode);
  if (geo.status !== '1' || !/^\d{6}$/.test(adcode)) throw fail('未找到目的地，请填写国内城市名称', 400);
  const region = `${adcode.slice(0, 4)}00`;
  const fetchedAt = new Date().toISOString();
  const spotKeyword = /博物|历史|人文/.test(request.preferences) ? '博物馆' : '旅游';
  const queries = [{ keywords: spotKeyword, types: '110000|140100' }, { keywords: '美食', types: '050000' }];
  // 两类查询有界并发；不抓取账号服务，也不抓取用户提供的 URL。
  const responses = await Promise.allSettled(queries.map((params) => query('/v5/place/text', { ...params, region, city_limit: true, page_size: 15, show_fields: 'business' })));
  if (request.hotel) {
    try { responses.push({ status: 'fulfilled', value: await query('/v5/place/text', { keywords: request.hotel, region, city_limit: true, page_size: 3, show_fields: 'business' }) }); }
    catch { responses.push({ status: 'rejected' }); }
  }
  const successful = responses.filter((row) => row.status === 'fulfilled' && row.value.status === '1');
  if (!successful.length) throw fail('高德候选地点搜索暂时不可用，请稍后重试');
  const places = [...new Map(successful.flatMap((row) => (row.value.pois || []).map((poi) => normalizePlace(poi, fetchedAt)).filter(Boolean)).map((poi) => [poi.sourceId, poi])).values()].slice(0, 40);
  if (!places.length) throw fail('目的地暂无可定位候选，请调整城市或需求后重试', 404);
  const sources = [
    { id: 'amap', platform: 'amap', name: '高德地图', url: 'https://www.amap.com/', status: 'queried', checkedAt: fetchedAt, excerpt: '已查询地点地址、坐标与平台返回的商户信息；路线尚未核验。' },
    sourceSummary('xiaohongshu'),
    sourceSummary('dianping'),
    ...references
  ];
  const warnings = successful.length < responses.length ? ['部分地点搜索失败，候选可能不完整。'] : [];
  if (request.hotel && !places.some((poi) => poi.name.includes(request.hotel))) warnings.push('住宿未匹配到明确地点，请确认酒店名称和地址，住宿往返路线尚未核验。');
  return { request, places, sources, warnings, fetchedAt, researchToken: signResearch({ request, places, sources, warnings }, identity) };
}
async function enrichResearch(input, identity, query = querySource) {
  const research = readResearch(input.researchToken, identity);
  let next = [];
  try {
    const result = await query(input.platform, input.step, research, input.noteId);
    const ids = new Set(result.sources.map((source) => source.id));
    research.sources = [...research.sources.filter((source) => !ids.has(source.id)), ...result.sources].slice(0, 50);
    next = result.next;
  } catch (error) {
    if (error.status === 400) throw error;
    const source = sourceSummary(input.platform);
    research.sources = research.sources.map((row) => row.id === input.platform ? { ...source, status: 'failed', excerpt: '来源采集失败或登录态失效，可检查服务后重试；其余来源仍可使用。' } : row);
  }
  return { request: research.request, places: research.places, sources: research.sources, warnings: research.warnings, next, researchToken: signResearch(research, identity) };
}
async function generateGuide(input, identity, complete = completeMessages) {
  const research = readResearch(input.researchToken, identity);
  if (!Array.isArray(input.sourceIds) || input.sourceIds.length < 1 || input.sourceIds.length > 24) throw fail('请选择 1–24 个地点用于规划', 400);
  const ids = new Set(input.sourceIds.map(String));
  const places = research.places.filter((place) => ids.has(place.sourceId));
  if (places.length !== ids.size) throw fail('所选地点不在已查询的候选中', 400);
  const request = research.request;
  const locations = places.map((place) => ({ ...place, id: `poi:${place.sourceId}`, isSnapshot: true, locationId: null }));
  const trip = { name: `${request.destination}${request.dayCount}天旅行攻略`, description: request.preferences.slice(0, 240), startDate: request.startDate || null, days: Array.from({ length: request.dayCount }, () => ({ items: [] })), roadbook: { origin: request.origin, travelers: request.travelers, mode: request.mode, budget: request.budget, preferences: request.preferences } };
  const messages = buildMessages(trip, locations, { dayCount: request.dayCount, requirements: JSON.stringify(request) });
  messages[0].content += `\n同时返回guide对象：{"overview":"整体安排与节奏","rainPlan":"下雨时的条件性调整方案","stayAdvice":"住宿与动线逻辑","pitfalls":["待核实的避坑提醒"],"bookingChecklist":["需自行确认的预约项目"]}。这些内容均为AI建议，只能引用实际传入且标为已查询的来源摘录，不能声称来自未接入或失败的小红书/点评。用户摘录仅代表用户提供，不能当成已抓取/已交叉验证；有冲突时说明差异，不作虚假核实。餐厅不能仅凭平台评分作保证。遵守已订住宿、同行人、预算、忌口和硬约束；无法满足时明确提示。guide每段不超过200字，每个清单最多6项；地点备注最多60字。`;
  messages[0].content += '\n已采集的不同来源可能指向不同分店，不能仅凭同名认定交叉验证通过；具体事实引用时写明来源名称。来源搜索摘要不等于笔记全文，正文摘录不等于所有评论；不要虚构评论结论。';
  messages[1].content = JSON.stringify({ ...JSON.parse(messages[1].content), sources: research.sources, facts: places.map((place) => ({ sourceId: place.sourceId, name: place.name, rating: place.rating, averageCost: place.averageCost, openingHours: place.openingHours, fetchedAt: place.fetchedAt })) });
  const raw = await complete(messages);
  let proposal;
  try { proposal = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw fail('AI攻略格式不完整，请重试'); }
  const planned = validatePlan(raw, trip, locations, request.dayCount);
  // 人数、交通、预算是用户约束，不能被模型悄悄改写。
  planned.roadbook = { ...planned.roadbook, ...trip.roadbook, guide: normalizeGuide({ ...proposal.guide, request, places, sources: research.sources, generatedAt: new Date().toISOString() }) };
  return { trip: planned, warnings: [...research.warnings, 'AI安排尚未核验时间可行性。保存后可查询逐段路线；票价、预约和开放时间请在出发前核实。'] };
}
module.exports = { collectResearch, enrichResearch, generateGuide, normalizePlace, readResearch, signResearch };
