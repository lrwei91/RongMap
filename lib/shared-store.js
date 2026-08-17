const crypto = require('crypto');
const { kv } = require('@vercel/kv');
const legacyStorage = require('./locations-storage');
const { buildLocationRecord, applyLocationUpdates } = require('./location-record');
const { isDuplicateLocation } = require('./location-duplicate');
const { getSupabaseAdmin } = require('./server-supabase');
const { optimizeRoute } = require('./trip-route');

const META_KEY = 'rongmap:shared:meta';
let memoryMeta = { tags: [], activity: [], shareLinks: [], members: [], trips: [] };

function toCamel(row = {}) {
  const tags = row.location_tags?.map((item) => item.tags).filter(Boolean) || row.tags || [];
  return {
    ...row,
    id: String(row.id),
    spaceId: row.space_id || row.spaceId,
    sourceId: row.source_id,
    sourceType: row.source_type,
    sourcePlatform: row.source_platform,
    sourceContent: row.source_content,
    matchType: row.match_type,
    poiType: row.poi_type,
    normalizedAddress: row.normalized_address,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    updatedBy: row.updated_by,
    deletedBy: row.deleted_by,
    deletedByName: row.deleted_by_name,
    ruleDecision: row.rule_decision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    tags
  };
}

function toTripSummary(row = {}) {
  const days = Array.isArray(row.trip_days) ? row.trip_days : [];
  return {
    id: String(row.id),
    spaceId: row.space_id,
    name: row.name,
    description: row.description || '',
    startDate: row.start_date || row.startDate || null,
    status: row.status || 'draft',
    version: Number(row.version || 1),
    createdBy: row.created_by || row.createdBy,
    updatedBy: row.updated_by || row.updatedBy,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    dayCount: Number(row.dayCount ?? row.day_count ?? days.length ?? 0),
    itemCount: Number(row.itemCount ?? row.item_count ?? days.reduce((sum, day) => sum + (day.trip_items?.length || 0), 0))
  };
}

function tripItemToClient(row = {}) {
  return {
    id: String(row.id),
    locationId: row.location_id || null,
    name: row.location_name || row.name || '地点',
    address: row.location_address || row.address || '',
    category: row.category || 'food',
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : '',
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : '',
    note: row.note || '',
    sortOrder: Number(row.sort_order || 0)
  };
}

function tripDayToClient(row = {}, items = row.trip_items || []) {
  return {
    id: String(row.id),
    dayIndex: Number(row.day_index || 1),
    date: row.visit_date || null,
    title: row.title || '',
    items: [...items].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)).map(tripItemToClient)
  };
}

function toDb(input, identity, existing = null) {
  const now = new Date().toISOString();
  const result = {
    space_id: identity.spaceId,
    name: String(input.name || existing?.name || '').trim().slice(0, 120),
    address: String(input.address || existing?.address || '').trim().slice(0, 240),
    category: ['food', 'spot', 'cafe_bar'].includes(input.category) ? input.category : existing?.category || 'food',
    reason: String(input.reason ?? existing?.reason ?? '').trim().slice(0, 240),
    latitude: input.latitude === '' || input.latitude == null ? null : Number(input.latitude),
    longitude: input.longitude === '' || input.longitude == null ? null : Number(input.longitude),
    source_id: input.sourceId || existing?.sourceId || null,
    source_type: input.sourceType || existing?.sourceType || 'manual',
    source_platform: input.sourcePlatform || existing?.sourcePlatform || 'web',
    updated_by: identity.user.id,
    updated_at: now
  };
  if (!existing) {
    result.id = crypto.randomUUID();
    result.created_by = identity.user.id;
    result.created_at = now;
    result.version = 1;
  }
  return result;
}

function validateLocation(input) {
  if (!String(input.name || '').trim() || !String(input.address || '').trim()) {
    const error = new Error('名称和地址不能为空'); error.status = 400; throw error;
  }
  const latitude = input.latitude === '' || input.latitude == null ? null : Number(input.latitude);
  const longitude = input.longitude === '' || input.longitude == null ? null : Number(input.longitude);
  if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    const error = new Error('纬度必须在 -90 到 90 之间'); error.status = 400; throw error;
  }
  if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    const error = new Error('经度必须在 -180 到 180 之间'); error.status = 400; throw error;
  }
}

async function getMeta() {
  try { return (await kv.get(META_KEY)) || memoryMeta; }
  catch { return memoryMeta; }
}

async function saveMeta(meta) {
  memoryMeta = meta;
  try { await kv.set(META_KEY, meta); } catch { /* local preview uses memory */ }
}

async function addActivity(identity, action, targetName = '', summary = '') {
  const supabase = getSupabaseAdmin();
  const item = { id: crypto.randomUUID(), space_id: identity.spaceId, actor_id: identity.user.id, actor_name: identity.user.name, action, target_name: targetName, summary, created_at: new Date().toISOString() };
  if (supabase) {
    await supabase.from('activity_logs').insert(item);
  } else {
    const meta = await getMeta();
    meta.activity = [{ id: item.id, actorId: item.actor_id, actorName: item.actor_name, action, targetName, summary, createdAt: item.created_at }, ...(meta.activity || [])].slice(0, 500);
    await saveMeta(meta);
  }
}

async function syncTags(supabase, locationId, tagIds = []) {
  if (!Array.isArray(tagIds)) return;
  await supabase.from('location_tags').delete().eq('location_id', locationId);
  if (tagIds.length) await supabase.from('location_tags').insert(tagIds.map((tagId) => ({ location_id: locationId, tag_id: tagId })));
}

async function loadShareLinkRows(supabase, spaceId) {
  let result = await supabase.from('share_links').select('id,label,scope,trip_id,created_at,revoked_at,last_accessed_at').eq('space_id', spaceId).order('created_at', { ascending: false });
  if (result.error?.code === '42703') {
    result = await supabase.from('share_links').select('id,label,created_at,revoked_at,last_accessed_at').eq('space_id', spaceId).order('created_at', { ascending: false });
  }
  return result;
}

async function loadTripSummaryRows(supabase, spaceId) {
  const result = await supabase.from('trips').select('id,space_id,name,description,start_date,status,version,created_by,updated_by,created_at,updated_at,trip_days(id,trip_items(id))').eq('space_id', spaceId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(500);
  return result.error?.code === '42P01' ? { data: [], error: null } : result;
}

async function bootstrap(identity) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const all = await legacyStorage.getLocations();
    const meta = await getMeta();
    const locations = all.filter((item) => !item.deletedAt).map((item) => ({ ...item, id: String(item.id), version: item.version || 1, tags: item.tags || [] }));
    const trash = all.filter((item) => item.deletedAt).map((item) => ({ ...item, id: String(item.id), tags: item.tags || [] }));
    const members = meta.members?.length ? meta.members : [{ id: identity.user.id, name: identity.user.name, email: identity.user.email, role: 'admin', status: 'active' }];
    const trips = (meta.trips || []).filter((item) => !item.deletedAt).map((item) => ({ ...toTripSummary(item), dayCount: item.days?.length || 0, itemCount: item.days?.reduce((sum, day) => sum + (day.items?.length || 0), 0) || 0 }));
    return { mode: 'legacy', currentUser: { ...identity.user, role: identity.role }, space: { id: identity.spaceId, name: '亲友共享地图', memberCount: members.length }, members, tags: meta.tags || [], locations, trash, trips, activity: meta.activity || [], shareLinks: meta.shareLinks || [] };
  }
  const [spaceResult, locationResult, trashResult, tagResult, memberResult, activityResult, linkResult, tripResult] = await Promise.all([
    supabase.from('spaces').select('*').eq('id', identity.spaceId).single(),
    supabase.from('locations').select('*, location_tags(tags(id,name))').eq('space_id', identity.spaceId).is('deleted_at', null).order('created_at', { ascending: false }).limit(5000),
    supabase.from('locations').select('*, location_tags(tags(id,name))').eq('space_id', identity.spaceId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(500),
    supabase.from('tags').select('*').eq('space_id', identity.spaceId).order('name'),
    supabase.from('space_members').select('user_id,role,status,created_at,profiles!space_members_user_id_fkey(name,email)').eq('space_id', identity.spaceId),
    supabase.from('activity_logs').select('*').eq('space_id', identity.spaceId).order('created_at', { ascending: false }).limit(300),
    loadShareLinkRows(supabase, identity.spaceId),
    loadTripSummaryRows(supabase, identity.spaceId)
  ]);
  const firstError = [spaceResult, locationResult, trashResult, tagResult, memberResult, activityResult, linkResult, tripResult].find((item) => item.error)?.error;
  if (firstError) throw firstError;
  return {
    mode: 'supabase',
    currentUser: { ...identity.user, role: identity.role },
    space: { id: spaceResult.data.id, name: spaceResult.data.name, memberCount: memberResult.data.length },
    members: memberResult.data.map((item) => ({ id: item.user_id, name: item.profiles?.name || item.profiles?.email?.split('@')[0] || '空间成员', email: item.profiles?.email || '', role: item.role, status: item.status, createdAt: item.created_at })),
    tags: tagResult.data,
    locations: locationResult.data.map(toCamel),
    trash: trashResult.data.map(toCamel),
    trips: tripResult.data.map(toTripSummary),
    activity: activityResult.data.map((item) => ({ id: item.id, actorId: item.actor_id, actorName: item.actor_name, action: item.action, targetName: item.target_name, summary: item.summary, createdAt: item.created_at })),
    shareLinks: linkResult.data.map((item) => ({ id: item.id, label: item.label, scope: item.scope || 'space', tripId: item.trip_id || null, createdAt: item.created_at, revokedAt: item.revoked_at, lastAccessedAt: item.last_accessed_at }))
  };
}

async function createLocation(identity, input) {
  validateLocation(input);
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const current = await legacyStorage.getLocations();
    const record = { ...buildLocationRecord({ ...input, createdBy: identity.user.id }, { id: crypto.randomUUID() }), tags: input.tagIds || [], version: 1, updatedAt: new Date().toISOString() };
    const duplicate = isDuplicateLocation(record, current.filter((item) => !item.deletedAt));
    if (duplicate.isDuplicate) { const error = new Error('地点已存在'); error.status = 409; error.existing = duplicate.existing; throw error; }
    current.push(record); await legacyStorage.saveLocations(current); await addActivity(identity, 'location_created', record.name); return record;
  }
  const candidate = buildLocationRecord(input, { id: crypto.randomUUID() });
  const duplicate = isDuplicateLocation(candidate, (await bootstrap(identity)).locations);
  if (duplicate.isDuplicate) {
    const error = new Error('地点已存在');
    error.status = 409;
    error.existing = duplicate.existing;
    throw error;
  }
  const row = toDb(input, identity);
  const { data, error } = await supabase.from('locations').insert(row).select().single();
  if (error) throw error;
  await syncTags(supabase, data.id, input.tagIds || []);
  await addActivity(identity, 'location_created', data.name);
  return toCamel(data);
}

async function updateLocation(identity, id, input) {
  validateLocation(input);
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const list = await legacyStorage.getLocations(); const index = list.findIndex((item) => String(item.id) === String(id));
    if (index < 0) { const error = new Error('未找到该地点'); error.status = 404; throw error; }
    if (input.version && Number(input.version) !== Number(list[index].version || 1)) { const error = new Error('地点已被其他成员修改'); error.status = 409; error.latest = list[index]; throw error; }
    list[index] = { ...applyLocationUpdates(list[index], input), tags: input.tagIds || list[index].tags || [], version: Number(list[index].version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: identity.user.id };
    await legacyStorage.saveLocations(list); await addActivity(identity, 'location_updated', list[index].name); return list[index];
  }
  let query = supabase.from('locations').update({ ...toDb(input, identity, input), version: Number(input.version || 1) + 1 }).eq('id', id).eq('space_id', identity.spaceId).is('deleted_at', null);
  if (input.version) query = query.eq('version', input.version);
  const { data, error } = await query.select().maybeSingle();
  if (error) throw error;
  if (!data) { const latest = await supabase.from('locations').select('*').eq('id', id).single(); const conflict = new Error('地点已被其他成员修改'); conflict.status = 409; conflict.latest = latest.data ? toCamel(latest.data) : null; throw conflict; }
  await syncTags(supabase, id, input.tagIds || []); await addActivity(identity, 'location_updated', data.name); return toCamel(data);
}

async function softDelete(identity, id) {
  const supabase = getSupabaseAdmin(); const now = new Date().toISOString();
  if (!supabase) {
    const list = await legacyStorage.getLocations(); const item = list.find((row) => String(row.id) === String(id)); if (!item) { const error = new Error('未找到该地点'); error.status = 404; throw error; }
    item.deletedAt = now; item.deletedBy = identity.user.id; item.deletedByName = identity.user.name; item.version = Number(item.version || 1) + 1; await legacyStorage.saveLocations(list); await addActivity(identity, 'location_deleted', item.name); return item;
  }
  const { data, error } = await supabase.from('locations').update({ deleted_at: now, deleted_by: identity.user.id, deleted_by_name: identity.user.name }).eq('id', id).eq('space_id', identity.spaceId).select().single(); if (error) throw error; await addActivity(identity, 'location_deleted', data.name); return toCamel(data);
}

async function restoreLocation(identity, id) {
  const supabase = getSupabaseAdmin();
  if (!supabase) { const list = await legacyStorage.getLocations(); const item = list.find((row) => String(row.id) === String(id)); if (!item) throw new Error('未找到该地点'); delete item.deletedAt; delete item.deletedBy; delete item.deletedByName; item.version = Number(item.version || 1) + 1; await legacyStorage.saveLocations(list); await addActivity(identity, 'location_restored', item.name); return item; }
  const { data, error } = await supabase.from('locations').update({ deleted_at: null, deleted_by: null, deleted_by_name: null }).eq('id', id).eq('space_id', identity.spaceId).select().single(); if (error) throw error; await addActivity(identity, 'location_restored', data.name); return toCamel(data);
}

async function purgeLocation(identity, id) {
  const supabase = getSupabaseAdmin();
  if (!supabase) { const list = await legacyStorage.getLocations(); const item = list.find((row) => String(row.id) === String(id)); await legacyStorage.saveLocations(list.filter((row) => String(row.id) !== String(id))); return item; }
  const { data, error } = await supabase.from('locations').delete().eq('id', id).eq('space_id', identity.spaceId).not('deleted_at', 'is', null).select().single(); if (error) throw error; return toCamel(data);
}

function dateForDay(startDate, dayIndex) {
  if (!startDate) return null;
  const date = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + dayIndex - 1);
  return date.toISOString().slice(0, 10);
}

function normalizeTripDate(value, fieldName) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error(`${fieldName}格式不正确`); error.status = 400; throw error;
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    const error = new Error(`${fieldName}不是有效日期`); error.status = 400; throw error;
  }
  return text;
}

function normalizeTripTime(value, fieldName) {
  if (value == null || value === '') return '';
  const text = String(value);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    const error = new Error(`${fieldName}不是有效时间`); error.status = 400; throw error;
  }
  return text;
}

function normalizeTripInput(input = {}) {
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) { const error = new Error('行程名称不能为空'); error.status = 400; throw error; }
  const description = String(input.description || '').trim().slice(0, 240);
  const startDate = normalizeTripDate(input.startDate, '开始日期');
  if (!Array.isArray(input.days) || input.days.length < 1 || input.days.length > 30) {
    const error = new Error('行程天数必须为 1 到 30 天'); error.status = 400; throw error;
  }
  let itemCount = 0;
  const days = input.days.map((day, index) => ({
    id: day.id || crypto.randomUUID(),
    dayIndex: index + 1,
    date: normalizeTripDate(day.date, `第 ${index + 1} 天日期`) || dateForDay(startDate, index + 1),
    title: String(day.title || '').trim().slice(0, 80),
    items: (Array.isArray(day.items) ? day.items : []).map((item, itemIndex) => {
      itemCount += 1;
      return {
        id: item.id || crypto.randomUUID(),
        locationId: item.locationId || null,
        name: String(item.name || '地点').trim().slice(0, 120) || '地点',
        address: String(item.address || '').trim().slice(0, 240),
        category: ['food', 'spot', 'cafe_bar'].includes(item.category) ? item.category : 'food',
        latitude: item.latitude === '' || item.latitude == null ? null : Number(item.latitude),
        longitude: item.longitude === '' || item.longitude == null ? null : Number(item.longitude),
        startTime: normalizeTripTime(item.startTime, '开始时间'),
        endTime: normalizeTripTime(item.endTime, '结束时间'),
        note: String(item.note || '').trim().slice(0, 240),
        sortOrder: itemIndex
      };
    })
  }));
  if (itemCount > 200) { const error = new Error('单个行程最多包含 200 个地点'); error.status = 400; throw error; }
  return { name, description, startDate, days, itemCount };
}

function summarizeTripChanges(latest = {}, input = {}) {
  const changedFields = [];
  if (String(input.name || '') !== String(latest.name || '')) changedFields.push('名称');
  if (String(input.description || '') !== String(latest.description || '')) changedFields.push('说明');
  if (String(input.startDate || '') !== String(latest.startDate || '')) changedFields.push('开始日期');
  if (JSON.stringify(input.days || []) !== JSON.stringify(latest.days || [])) changedFields.push('每日安排');
  return {
    localVersion: Number(input.version || 0),
    latestVersion: Number(latest.version || 0),
    changedFields,
    dayCount: Array.isArray(input.days) ? input.days.length : 0,
    itemCount: Array.isArray(input.days) ? input.days.reduce((sum, day) => sum + (day.items?.length || 0), 0) : 0
  };
}

async function getTrip(identity, id) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const meta = await getMeta();
    const trip = (meta.trips || []).find((item) => String(item.id) === String(id) && !item.deletedAt);
    if (!trip) { const error = new Error('未找到该行程'); error.status = 404; throw error; }
    return JSON.parse(JSON.stringify(trip));
  }
  const tripResult = await supabase.from('trips').select('*').eq('id', id).eq('space_id', identity.spaceId).is('deleted_at', null).maybeSingle();
  if (tripResult.error) throw tripResult.error;
  if (!tripResult.data) { const error = new Error('未找到该行程'); error.status = 404; throw error; }
  const dayResult = await supabase.from('trip_days').select('*').eq('trip_id', id).order('day_index');
  if (dayResult.error) throw dayResult.error;
  const dayIds = dayResult.data.map((day) => day.id);
  const itemResult = dayIds.length
    ? await supabase.from('trip_items').select('*').in('day_id', dayIds).order('sort_order')
    : { data: [], error: null };
  if (itemResult.error) throw itemResult.error;
  const itemsByDay = new Map();
  itemResult.data.forEach((item) => {
    if (!itemsByDay.has(item.day_id)) itemsByDay.set(item.day_id, []);
    itemsByDay.get(item.day_id).push(item);
  });
  return { ...toTripSummary(tripResult.data), days: dayResult.data.map((day) => tripDayToClient(day, itemsByDay.get(day.id) || [])) };
}

async function saveTrip(identity, id, input, activityAction = id ? 'trip_updated' : 'trip_created') {
  const normalized = normalizeTripInput(input);
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const meta = await getMeta();
    meta.trips ||= [];
    const index = id ? meta.trips.findIndex((item) => String(item.id) === String(id) && !item.deletedAt) : -1;
    if (id && index < 0) { const error = new Error('未找到该行程'); error.status = 404; throw error; }
    const existing = index >= 0 ? meta.trips[index] : null;
    if (existing && Number(input.version) !== Number(existing.version || 1)) {
      const error = new Error('行程已被其他成员修改'); error.status = 409; error.latest = existing; error.localSummary = summarizeTripChanges(existing, input); throw error;
    }
    const now = new Date().toISOString();
    const trip = {
      ...normalized,
      id: existing?.id || crypto.randomUUID(),
      spaceId: identity.spaceId,
      status: input.status === 'ready' ? 'ready' : existing?.status || 'draft',
      version: existing ? Number(existing.version || 1) + 1 : 1,
      createdBy: existing?.createdBy || identity.user.id,
      updatedBy: identity.user.id,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (index >= 0) meta.trips[index] = trip; else meta.trips.unshift(trip);
    await saveMeta(meta);
    await addActivity(identity, activityAction, trip.name);
    return JSON.parse(JSON.stringify(trip));
  }
  const result = await supabase.rpc('save_trip_plan', {
    p_trip_id: id || null,
    p_space_id: identity.spaceId,
    p_actor_id: identity.user.id,
    p_expected_version: id ? Number(input.version || 0) : null,
    p_name: normalized.name,
    p_description: normalized.description,
    p_start_date: normalized.startDate || '',
    p_days: normalized.days,
    p_activity_action: activityAction
  });
  if (result.error) {
    if (result.error.code === '42P01') result.error.status = 503;
    if (result.error.code === 'P0002') result.error.status = 404;
    if (['22007', '22008', '22023', '22P02'].includes(result.error.code)) result.error.status = 400;
    if (result.error.code === '42501') result.error.status = 403;
    throw result.error;
  }
  if (result.data?.conflict) {
    const error = new Error('行程已被其他成员修改'); error.status = 409; error.latest = await getTrip(identity, id); error.localSummary = summarizeTripChanges(error.latest, input); throw error;
  }
  return getTrip(identity, result.data.tripId);
}

async function optimizeTrip(identity, id, input = {}) {
  const trip = await getTrip(identity, id);
  if (Number(input.version) !== Number(trip.version)) {
    const error = new Error('行程已被其他成员修改');
    error.status = 409;
    error.latest = trip;
    error.localSummary = { localVersion: Number(input.version || 0), latestVersion: trip.version, changedFields: ['路线优化'], dayCount: trip.days.length, itemCount: trip.days.reduce((sum, day) => sum + day.items.length, 0) };
    throw error;
  }
  const targetDay = Number(input.dayIndex || 0);
  const reports = [];
  const days = trip.days.map((day) => {
    if (targetDay && day.dayIndex !== targetDay) return day;
    const optimized = optimizeRoute(day.items);
    reports.push({ dayIndex: day.dayIndex, beforeKm: optimized.beforeKm, afterKm: optimized.afterKm, skipped: optimized.skipped, improved: optimized.improved });
    return { ...day, items: optimized.items.map((item, index) => ({ ...item, sortOrder: index })) };
  });
  const saved = await saveTrip(identity, id, { ...trip, days }, 'trip_optimized');
  return { ...saved, optimization: reports };
}

async function deleteTrip(identity, id) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const meta = await getMeta();
    const trip = (meta.trips || []).find((item) => String(item.id) === String(id) && !item.deletedAt);
    if (!trip) { const error = new Error('未找到该行程'); error.status = 404; throw error; }
    trip.deletedAt = new Date().toISOString();
    trip.version = Number(trip.version || 1) + 1;
    await saveMeta(meta); await addActivity(identity, 'trip_deleted', trip.name); return trip;
  }
  const trip = await getTrip(identity, id);
  const result = await supabase.from('trips').update({ deleted_at: new Date().toISOString(), updated_by: identity.user.id, version: trip.version + 1 }).eq('id', id).eq('space_id', identity.spaceId);
  if (result.error) throw result.error;
  await addActivity(identity, 'trip_deleted', trip.name);
  return trip;
}

module.exports = {
  bootstrap, createLocation, updateLocation, softDelete, restoreLocation, purgeLocation,
  getTrip, saveTrip, optimizeTrip, deleteTrip,
  addActivity, getMeta, saveMeta, toCamel, toTripSummary, validateLocation, normalizeTripInput, summarizeTripChanges
};
