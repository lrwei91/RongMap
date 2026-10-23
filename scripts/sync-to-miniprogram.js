#!/usr/bin/env node
/**
 * Web(Supabase) → 小程序(WorkBuddy 云库) 单向数据同步。
 *
 * 用法：
 *   npm run sync:miniprogram                # 执行同步（Web 为唯一真相源）
 *   npm run sync:miniprogram -- --dry-run   # 只对账，不写入
 *
 * 行为：
 *   - 对账键：source_id 优先（POI id 稳定），其次「名称|规范化地址」，最后仅名称（两侧唯一时）。
 *   - 云库缺行      → 按字段映射补插：时间戳/坐标/类别/来源/version 原样保留，
 *                     owner_id 落空间 owner（wx: 身份），created_by 保留 Supabase uuid、
 *                     created_by_name「空间管理员」。
 *   - 删除状态不一致 → 以 Web 侧为准对齐（deleted_at/deleted_by/deleted_by_name）。
 *   - 其他字段差异   → 只报告，不自动改。
 *   - 云库独有行     → 只报告，不自动删。
 *   - 标签（tags/location_tags）按名称补齐。
 *   - WEB_ONLY 清单：5 条 MCP 自测垃圾按 2026-10-21 拍板保持 Web 私有，永不下发。
 *
 * 认证：
 *   会话缓存 ~/.hermes/state/rongmap-sync/session.json（过期自动用 wbrt_ 续期）；
 *   续期失效才回落开发者工具自动化重新登录（IDE 登录态过期需用户扫码，
 *   全流程见技能 wechat-miniprogram-automation）。云库调用必须带小程序来源头，
 *   否则网关以 invalid_grant「issued for another client」拒绝（看着像会话问题）。
 */
require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' });
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const CLOUD_ENDPOINT = 'https://mp-api.app.workbuddy.host';
const PUBLISHABLE_KEY = 'wbpk_8AhQ0BJhwyTslmq5vMlokg_G5J26NbzmzNu33Omldpp7fFJMefJvFhz';
const APPID = 'wxd1b6613925c4b3b8'; // 小程序正式 appid（云服务登记值）
const SESSION_FILE = process.env.RONGMAP_SYNC_SESSION
  || path.join(os.homedir(), '.hermes/state/rongmap-sync/session.json');
const SDK_PATH = path.resolve(__dirname, '../miniprogram/node_modules/@tencent-ai/workbuddy-cloud-sdk/lib/index.cjs');
const PROJECT_CONFIG = path.resolve(__dirname, '../miniprogram/project.config.json');
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const AUTO_PORT = 9420;

// 2026-10-21 拍板：MCP 自测垃圾只留 Web 侧，不同步小程序端
const WEB_ONLY = new Set([
  '小鲤自测点（可删）',
  '小鲤自测点2（可删）',
  '小鲤自测点3（已改名）',
  '公网写入自测（已改名）',
  'Muse写测试-可删',
]);

// 2026-10-22 拍板：这 10 条只留 Web 侧，小程序端已移除——同步不得回灌、不得复活
const CLOUD_REMOVED = new Set([
  '半杯理想·山海小馆',
  '抛抛饭店(PAO TABLE)',
  '歇卜',
  '大廖(大廖理bistro)',
  '米店(OPEN RICE)',
  '滇滇·云南烧肉米线',
  '三山揽月',
  '山下有',
  '牡蛎咖啡',
  '當好食(Danghus)',
]);

const norm = (s) => String(s || '').replace(/[\s\u3000]/g, '').toLowerCase();
const dryRun = process.argv.includes('--dry-run');

// ---------- Web（Supabase）侧 ----------
async function loadWebData() {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error('请配置 SUPABASE_URL 与 SUPABASE_SECRET_KEY（.env.local）');
  const get = async (table, qs) => {
    const res = await fetch(`${base}/rest/v1/${table}?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Supabase ${table} 查询失败：${JSON.stringify(data).slice(0, 200)}`);
    return data;
  };
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await get('locations', `select=*&order=created_at.asc&limit=1000&offset=${from}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return { rows, get };
}

// ---------- 云库（WorkBuddy）侧 ----------
function seedStorage() {
  let seed = {};
  try { seed = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (_) { /* 首次无缓存 */ }
  return {
    seed,
    storage: {
      getItem: (k) => (k in seed ? seed[k] : null),
      setItem: (k, v) => { seed[k] = String(v); },
      removeItem: (k) => { delete seed[k]; },
    },
    save() {
      fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
      fs.writeFileSync(SESSION_FILE, JSON.stringify(seed, null, 1));
    },
  };
}

function makeCloud(sessionStore) {
  const { createWorkBuddyCloud } = require(SDK_PATH);
  // 网关按小程序来源（appid + Referer）校验请求客户端，节点侧必须模拟 wx.request 来源头
  const wxFetch = (input, init = {}) => {
    const h = new Headers(init.headers || {});
    h.set('Referer', `https://servicewechat.com/${APPID}/1.0.0/page-frame.html`);
    h.set('Origin', 'https://servicewechat.com');
    return fetch(input, { ...init, headers: h });
  };
  return createWorkBuddyCloud({
    endpoint: CLOUD_ENDPOINT,
    publishableKey: PUBLISHABLE_KEY,
    storage: sessionStore.storage,
    fetch: wxFetch,
  });
}

/** 开发者工具自动化重新登录：临时切正式 appid → 小程序内 wechatLogin() → 取回会话。 */
async function devtoolsRelogin(sessionStore) {
  const automator = require(path.resolve(__dirname, '../miniprogram/node_modules/miniprogram-automator'));
  console.log('[登录] 会话缓存失效，走开发者工具重新登录…');
  const bak = fs.readFileSync(PROJECT_CONFIG, 'utf8');
  try {
    const conf = JSON.parse(bak);
    conf.appid = APPID;
    fs.writeFileSync(PROJECT_CONFIG, JSON.stringify(conf, null, 2));
    try { execSync(`pkill -f 'WeChatwebdevtools' 2>/dev/null; pkill -f 'wechatwebdevtools' 2>/dev/null`, { stdio: 'ignore' }); } catch (_) {}
    await new Promise((r) => setTimeout(r, 3000));
    const logPath = path.join(os.tmpdir(), `rongmap-cli-auto-${Date.now()}.log`);
    const logFd = fs.openSync(logPath, 'w');
    spawn(CLI, ['auto', '--project', path.dirname(PROJECT_CONFIG), '--auto-port', String(AUTO_PORT), '--trust-project'], { detached: true, stdio: ['ignore', logFd, logFd] }).unref();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (/✔ auto|listening on ws|auto$/.test(fs.readFileSync(logPath, 'utf8'))) break;
      if (/需要重新登录/.test(fs.readFileSync(logPath, 'utf8'))) {
        throw new Error('开发者工具 IDE 登录态过期：需要用户扫码。跑 cli login 生成二维码（流程见技能 wechat-miniprogram-automation）');
      }
    }
    const mp = await automator.connect({ wsEndpoint: `ws://localhost:${AUTO_PORT}` });
    // 注意：节点侧 signInWithWechat 必被拒（invalid_grant），必须在小程序运行时内登录
    const out = await mp.evaluate(() => new Promise((resolve) => {
      const tryPaths = ['./utils/session.js', '/utils/session.js', 'utils/session.js'];
      let session = null;
      for (const p of tryPaths) { try { session = require(p); break; } catch (_) {} }
      if (!session || !session.wechatLogin) { resolve('ERR:require'); return; }
      session.wechatLogin().then((s) => resolve('OK:' + (s && s.user && s.user.id)))
        .catch((e) => resolve('ERR:' + String(e && e.message)));
    }));
    if (!String(out).startsWith('OK:')) throw new Error(`小程序内登录失败：${out}`);
    const info = await mp.callWxMethod('getStorageInfoSync');
    for (const k of info.keys || []) sessionStore.storage.setItem(k, await mp.callWxMethod('getStorageSync', k));
    sessionStore.save();
    console.log('[登录]', out, '会话已缓存');
    await mp.disconnect();
  } finally {
    fs.writeFileSync(PROJECT_CONFIG, bak); // 还原项目配置，不进 git
    try { execSync(`${CLI} quit 2>/dev/null`, { stdio: 'ignore' }); } catch (_) {}
  }
}

async function getCloud() {
  const sessionStore = seedStorage();
  const cloud = makeCloud(sessionStore);
  try {
    const s = await cloud.auth.getSession();
    if (s.error || !s.data) throw new Error('no session');
    sessionStore.save();
    return { cloud, sessionStore, uid: s.data.user.id };
  } catch (_) {
    await devtoolsRelogin(sessionStore);
    const cloud2 = makeCloud(sessionStore);
    const s2 = await cloud2.auth.getSession();
    if (s2.error || !s2.data) throw new Error(`重新登录后仍无会话：${JSON.stringify(s2.error || {}).slice(0, 200)}`);
    return { cloud: cloud2, sessionStore, uid: s2.data.user.id };
  }
}

async function loadCloudRows(cloud) {
  const rows = [];
  for (let from = 0; ; from += 200) {
    const r = await cloud.database.from('locations')
      .select('*, location_tags(tags(id,name))')
      .order('created_at', { ascending: true }).range(from, from + 199);
    if (r.error) throw new Error(`云库读取失败：${JSON.stringify(r.error).slice(0, 200)}`);
    rows.push(...(r.data || []));
    if (!r.data || r.data.length < 200) break;
  }
  return rows;
}

// ---------- 对账 ----------
function matchRows(web, cloudRows) {
  const pairs = [];
  const wLeft = [...web];
  const cLeft = [...cloudRows];
  const take = (test) => {
    for (let i = wLeft.length - 1; i >= 0; i--) {
      const w = wLeft[i];
      const j = cLeft.findIndex((c) => test(w, c));
      if (j >= 0) { pairs.push([w, cLeft.splice(j, 1)[0]]); wLeft.splice(i, 1); }
    }
  };
  take((w, c) => w.source_id && c.source_id && w.source_id === c.source_id);
  take((w, c) => norm(w.name) + '|' + norm(w.address) === norm(c.name) + '|' + norm(c.address));
  take((w, c) => norm(w.name) === norm(c.name)); // 名称两侧唯一才走到这
  return { pairs, webOnly: wLeft, cloudOnly: cLeft };
}

const FIELD_MAP = {
  address: 'address', category: 'category', reason: 'reason', latitude: 'latitude', longitude: 'longitude',
  source_id: 'source_id', source_type: 'source_type', source_platform: 'source_platform',
  source_content: 'source_content', match_type: 'match_type', poi_type: 'poi_type',
  normalized_address: 'normalized_address', city: 'city', district: 'district',
};

async function main() {
  console.log(`== RongMap 同步 Web → 小程序端 ${dryRun ? '（dry-run）' : ''} ==`);
  const { rows: webRows, get } = await loadWebData();
  const { cloud, sessionStore, uid } = await getCloud();
  const cloudRows = await loadCloudRows(cloud);
  const space = await cloud.database.from('spaces').select('*').limit(1);
  const ownerId = (space.data && space.data[0] && space.data[0].owner_id) || uid;
  console.log(`Web ${webRows.length} 行 | 云库 ${cloudRows.length} 行 | owner: ${ownerId}`);

  const { pairs, webOnly, cloudOnly } = matchRows(webRows, cloudRows);
  const todo = webOnly.filter((r) => !WEB_ONLY.has(r.name) && !CLOUD_REMOVED.has(r.name));
  const skipped = webOnly.filter((r) => WEB_ONLY.has(r.name));
  const removedSkip = webOnly.filter((r) => CLOUD_REMOVED.has(r.name));

  // 字段差异（只报不改）
  const fieldDiffs = [];
  for (const [w, c] of pairs) {
    const bad = Object.entries(FIELD_MAP).filter(([wk, ck]) => w[wk] != null && String(w[wk]) !== String(c[ck])).map(([wk]) => wk);
    if (bad.length) fieldDiffs.push(`${w.name}: ${bad.join(',')}`);
  }
  // 删除状态差异（以 Web 为准）；CLOUD_REMOVED 名单内保持小程序端移除，不复活
  const statusDiffs = pairs.filter(([w, c]) => !!w.deleted_at !== !!c.deleted_at && !CLOUD_REMOVED.has(w.name));
  const keptRemoved = pairs.filter(([w]) => CLOUD_REMOVED.has(w.name) && !w.deleted_at);

  console.log(`\n-- 补插（云库缺）: ${todo.length}`);
  for (const r of todo) console.log(`   + ${r.name} | ${(r.address || '').slice(0, 22)} | ${r.deleted_at ? '软删' : '活跃'} | ${r.created_at}`);
  if (skipped.length) console.log(`-- 按拍板跳过（测试垃圾）: ${skipped.length} → ${skipped.map((r) => r.name).join('、')}`);
  if (removedSkip.length) console.log(`-- 按拍板跳过（小程序端已移除，不回灌）: ${removedSkip.length} → ${removedSkip.map((r) => r.name).join('、')}`);
  if (keptRemoved.length) console.log(`-- 按拍板保持小程序端移除（不复活）: ${keptRemoved.length} → ${keptRemoved.map(([w]) => w.name).join('、')}`);
  if (cloudOnly.length) console.log(`-- 云库独有（只报不删）: ${cloudOnly.length} → ${cloudOnly.map((r) => r.name).join('、')}`);
  if (fieldDiffs.length) console.log(`-- 字段差异（只报不改）: ${fieldDiffs.join(' | ')}`);
  if (statusDiffs.length) console.log(`-- 删除状态对齐（Web 为准）: ${statusDiffs.map(([w]) => w.name).join('、')}`);

  if (dryRun) { console.log('\n[dry-run] 未写入'); return; }

  // 1) 补插
  if (todo.length) {
    const payload = todo.map((r) => ({
      space_id: (space.data && space.data[0] && space.data[0].id) || 1,
      owner_id: ownerId,
      name: r.name, address: r.address || '', category: r.category || 'food', reason: r.reason || '',
      latitude: r.latitude, longitude: r.longitude,
      source_id: r.source_id, source_type: r.source_type || 'manual', source_platform: r.source_platform || 'web',
      source_content: r.source_content, match_type: r.match_type, poi_type: r.poi_type,
      normalized_address: r.normalized_address || '', city: r.city, district: r.district,
      confidence: (typeof r.confidence === 'number' && Number.isFinite(r.confidence)) ? r.confidence : null,
      rule_decision: r.rule_decision,
      version: r.version || 1,
      created_by: r.created_by, created_by_name: '空间管理员', updated_by: r.updated_by || r.created_by,
      created_at: r.created_at, updated_at: r.updated_at || r.created_at,
    }));
    const ins = await cloud.database.from('locations').insert(payload).select();
    if (ins.error) throw new Error(`补插失败：${JSON.stringify(ins.error).slice(0, 300)}`);
    console.log(`\n已补插 ${ins.data.length} 条 → id ${ins.data.map((x) => x.id).join(',')}`);

    // 标签按名称补齐
    const ids = todo.map((r) => `"${r.id}"`).join(',');
    const links = await get('location_tags', `select=location_id,tags(id,name)&location_id=in.(${ids})`);
    if (links.length) {
      const tr = await cloud.database.from('tags').select('*');
      const tagByName = new Map((tr.data || []).map((t) => [t.name, t]));
      const names = [...new Set(links.map((l) => l.tags && l.tags.name).filter(Boolean))];
      const missing = names.filter((n) => !tagByName.has(n));
      if (missing.length) {
        const ti = await cloud.database.from('tags').insert(missing.map((n) => ({ space_id: space.data[0].id, name: n, owner_id: ownerId }))).select();
        if (!ti.error) for (const t of ti.data) tagByName.set(t.name, t);
      }
      const byWebId = new Map(todo.map((r, i) => [r.id, ins.data[i]]));
      const rows = links.map((l) => {
        const loc = byWebId.get(l.location_id); const tag = l.tags && tagByName.get(l.tags.name);
        return loc && tag ? { location_id: loc.id, tag_id: tag.id, owner_id: ownerId } : null;
      }).filter(Boolean);
      if (rows.length) await cloud.database.from('location_tags').insert(rows);
      console.log(`标签链接: ${rows.length} 条`);
    }
  }

  // 2) 删除状态对齐（Web 为准）
  for (const [w, c] of statusDiffs) {
    const patch = w.deleted_at
      ? { deleted_at: w.deleted_at, deleted_by: w.deleted_by || w.updated_by, deleted_by_name: w.deleted_by_name || '空间管理员' }
      : { deleted_at: null, deleted_by: null, deleted_by_name: null };
    const up = await cloud.database.from('locations').update(patch).eq('id', c.id);
    if (up.error) throw new Error(`删除状态对齐失败（${w.name}）：${JSON.stringify(up.error).slice(0, 200)}`);
    console.log(`删除状态对齐: ${w.name} → ${w.deleted_at ? '软删' : '恢复活跃'}`);
  }

  // 3) 终态核验
  const after = await loadCloudRows(cloud);
  const final = matchRows(webRows, after);
  const remain = final.webOnly.filter((r) => !WEB_ONLY.has(r.name) && !CLOUD_REMOVED.has(r.name));
  console.log(`\n== 终态 == 云库 ${after.length} 行 | 仍缺 ${remain.length} 条 | 云库独有 ${final.cloudOnly.length} 条 | 会话已续期缓存`);
  if (remain.length || final.cloudOnly.length) process.exitCode = 1;
}

main().catch((e) => { console.error('同步失败:', e && (e.message || e)); process.exit(1); });
