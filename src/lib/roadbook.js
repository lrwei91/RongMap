import { hasCoordinates } from './location';
export const EMPTY_ROADBOOK = { mode: 'car', origin: '', travelers: 1, preferences: '', budget: '', tickets: [], clothing: '', tips: '' };
export const MODES = { car: '自驾', transit: '公共交通', walk: '步行' };
export function budgetTotal(tickets = []) {
  const known = tickets.filter((ticket) => ticket.price !== '' && ticket.price != null && Number.isFinite(Number(ticket.price)));
  return { total: known.reduce((sum, ticket) => sum + Number(ticket.price), 0), unknown: tickets.length - known.length };
}
export function navigationUrl(from, to, mode = 'car') {
  if (!hasCoordinates(from) || !hasCoordinates(to)) return null;
  return `https://uri.amap.com/navigation?from=${Number(from.longitude)},${Number(from.latitude)},${encodeURIComponent(from.name)}&to=${Number(to.longitude)},${Number(to.latitude)},${encodeURIComponent(to.name)}&mode=${mode === 'walk' ? 'walk' : mode === 'transit' ? 'bus' : 'car'}&src=rongmap&coordinate=gaode&callnative=1`;
}
export function dayDate(trip, day) {
  if (day.date) return day.date;
  if (!trip.startDate) return '';
  const date = new Date(`${trip.startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + day.dayIndex - 1);
  return date.toISOString().slice(0, 10);
}
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function roadbookHtml(trip) {
  const book = { ...EMPTY_ROADBOOK, ...trip.roadbook };
  const budget = budgetTotal(book.tickets);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(trip.name)}</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:16px;color:#1a1a1a}section{border-top:1px solid #ddd;margin-top:24px}article{padding:12px;border-bottom:1px solid #eee}p{white-space:pre-wrap}a{color:inherit}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}table{width:100%;border-collapse:collapse}</style><h1>${escape(trip.name)}</h1><p>${escape(trip.description)}</p>${book.aiGenerated ? '<p>本路书包含 AI 规划建议，行程时间、预约、票价与出行提醒需核实。</p>' : ''}<p>${escape(book.origin || '出发地待补充')} · ${escape(MODES[book.mode])} · ${escape(book.travelers)} 人</p><p>${escape(book.preferences)}</p>${trip.days.map((day) => `<section><h2>第 ${day.dayIndex} 天 · ${escape(dayDate(trip, day) || '日期待定')} ${escape(day.title)}</h2>${day.items.map((item, index) => `<article><strong>${index + 1}. ${escape(item.name)}</strong><p>${escape(item.startTime)}${item.endTime ? `–${escape(item.endTime)}` : ''} ${escape(item.address)}</p><p>${escape(item.note)}</p>${index && navigationUrl(day.items[index - 1], item, book.mode) ? `<a href="${escape(navigationUrl(day.items[index - 1], item, book.mode))}">高德导航至本站</a>` : ''}</article>`).join('')}</section>`).join('')}<section><h2>门票与花费参考（人均）</h2><table><tr><th>项目</th><th>金额</th><th>预约与来源</th></tr>${book.tickets.map((ticket) => `<tr><td>${escape(ticket.name)}</td><td>${ticket.price == null || ticket.price === '' ? '待核实' : `¥${escape(ticket.price)}`}</td><td>${escape(ticket.reservation)}<br>${escape(ticket.source || '未提供来源')}</td></tr>`).join('')}</table><p>已填合计 ¥${budget.total}；${budget.unknown} 项金额待核实。人均预算 ${book.budget === '' || book.budget == null ? '待补充' : `¥${escape(book.budget)}`}。</p></section><section><h2>穿着建议</h2><p>${escape(book.clothing || '待补充')}</p><h2>注意事项</h2><p>${escape(book.tips || '待补充')}</p></section><p>天气、里程与票价请在出发前再次核实；此文件为导出时的行程快照。</p></html>`;
}
export function downloadRoadbook(trip) {
  const url = URL.createObjectURL(new Blob([roadbookHtml(trip)], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${trip.name.replace(/[\\/:*?"<>|]/g, '-')}-路书.html`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
