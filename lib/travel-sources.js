const fail = () => Object.assign(new Error('来源服务暂时不可用或未登录，请检查本地服务后重试'), { status: 502 });
const urls = () => ({ xiaohongshu: process.env.XHS_MCP_URL || '', dianping: process.env.CN_SCRAPER_URL || '' });
const text = (value) => typeof value === 'string' ? value : '';
let rpcId = 0;
function parseRpc(body, id) {
  const rows = body.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
  const candidates = rows.length ? rows : [body];
  for (const row of candidates) {
    try { const value = JSON.parse(row); if (value.id === id) return value; } catch { /* Skip non-JSON SSE events. */ }
  }
  throw fail();
}
async function readBounded(response) {
  if (!response.ok || !response.body) throw fail();
  const reader = response.body.getReader(); let size = 0, value = ''; const decoder = new TextDecoder();
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1024 * 1024) throw fail(); value += decoder.decode(part.value, { stream: true }); } }
  finally { await reader.cancel().catch(() => {}); }
  return value + decoder.decode();
}
async function callMcp(platform, name, args, fetchImpl = fetch) {
  const configured = urls()[platform];
  if (!configured) throw Object.assign(new Error('尚未配置来源服务'), { status: 503 });
  let url;
  try { url = new URL(configured); } catch { throw fail(); }
  // Only server-controlled endpoints are used. No endpoint or cookie is accepted from the browser.
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), platform === 'xiaohongshu' ? 220000 : 100000);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const serviceToken = process.env[platform === 'xiaohongshu' ? 'XHS_MCP_TOKEN' : 'CN_SCRAPER_TOKEN'];
  if (serviceToken) headers.Authorization = `Bearer ${serviceToken}`;
  const post = (body) => fetchImpl(url.href, { method: 'POST', redirect: 'error', signal: controller.signal, headers, body: JSON.stringify(body) });
  try {
    const initId = ++rpcId;
    const initialized = await post({ jsonrpc: '2.0', id: initId, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'rongmap-travel', version: '1.0' } } });
    const init = parseRpc(await readBounded(initialized), initId);
    if (init.error) throw fail();
    const session = initialized.headers.get('mcp-session-id');
    if (session) headers['mcp-session-id'] = session;
    const notification = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await notification.body?.cancel().catch(() => {});
    const id = ++rpcId;
    const response = await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const rpc = parseRpc(await readBounded(response), id);
    if (rpc.error || rpc.result?.isError) throw fail();
    const value = rpc.result?.structuredContent || (rpc.result?.content || []).map((part) => part.type === 'text' ? part.text : '').join('\n');
    if (typeof value === 'object' && value) return value;
    try { return JSON.parse(value); } catch { throw fail(); }
  } catch { throw fail(); }
  finally { clearTimeout(timer); }
}
function sourceSummary(platform) {
  return { id: platform, platform, name: platform === 'xiaohongshu' ? '小红书' : '大众点评', status: urls()[platform] ? 'pending' : 'not_configured', excerpt: urls()[platform] ? '服务已配置，尚未查询。' : '尚未接入自动采集，可补充链接和摘录。' };
}
async function querySource(platform, step, research, noteId, call = callMcp) {
  const destination = research.request.destination;
  if (!['xiaohongshu', 'dianping'].includes(platform)) throw Object.assign(new Error('不支持的攻略来源'), { status: 400 });
  const source = sourceSummary(platform);
  const at = new Date().toISOString();
  if (step === 'search') {
    const result = platform === 'xiaohongshu'
      ? await call(platform, 'search_feeds', { keyword: `${destination} ${research.request.dayCount}天 攻略 避坑`, filters: { sort_by: '最多收藏' } })
      : await call(platform, 'dianping_search', { keyword: '美食', city: destination });
    const rows = platform === 'xiaohongshu' ? result.feeds || result.data?.feeds || [] : result.shops || result.data?.shops || result.results || (Array.isArray(result) ? result : []);
    const notes = rows.slice(0, 6).map((row) => {
      const card = row.noteCard || row.note_card || row;
      return { id: text(row.id || row.shop_id), title: text(card.displayTitle || card.title || card.name || row.shop_name).slice(0, 120), token: text(row.xsecToken || row.xsec_token) };
    }).filter((row) => row.id && row.title);
    if (!notes.length) throw fail();
    research.pendingNotes = { ...research.pendingNotes, [platform]: notes };
    return { sources: [{ ...source, status: 'queried', checkedAt: at, excerpt: `已检索 ${notes.length} 条候选；正文/商户详情尚待读取。` }], next: notes.slice(0, 2).map(({ id, title }) => ({ id, title })) };
  }
  const note = research.pendingNotes?.[platform]?.find((item) => item.id === noteId);
  if (step !== 'detail' || !note) throw Object.assign(new Error('请选择已检索的来源详情'), { status: 400 });
  const result = platform === 'xiaohongshu'
    ? await call(platform, 'get_feed_detail', { feed_id: note.id, xsec_token: note.token, load_all_comments: false })
    : await call(platform, 'dianping_shop', { shop_id: note.id });
  const data = result.data || result;
  const detail = data.note || data.shop || data.noteDetail || data;
  const excerpt = platform === 'xiaohongshu'
    ? [text(detail.desc || detail.description || detail.content), ...(Array.isArray(data.comments) ? data.comments.slice(0, 6).map((row) => `评论：${text(row.content)}`) : [])].filter(Boolean).join('\n')
    : [text(detail.name || detail.shop_name), text(detail.address), detail.rating != null ? `点评评分：${detail.rating}` : '', detail.price != null ? `点评人均：${detail.price}` : '', text(detail.business_hours || detail.opening_hours)].filter(Boolean).join('；');
  if (!excerpt) throw fail();
  return { sources: [{ id: `${platform}:${note.id}`, platform, name: note.title, status: 'queried', checkedAt: at, excerpt: excerpt.slice(0, 1000), url: platform === 'xiaohongshu' ? `https://www.xiaohongshu.com/explore/${encodeURIComponent(note.id)}` : `https://www.dianping.com/shop/${encodeURIComponent(note.id)}` }], next: [] };
}
module.exports = { callMcp, querySource, sourceSummary, parseRpc };
