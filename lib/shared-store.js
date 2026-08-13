const crypto = require('crypto');
const { kv } = require('@vercel/kv');
const legacyStorage = require('./locations-storage');
const { buildLocationRecord, applyLocationUpdates } = require('./location-record');
const { isDuplicateLocation } = require('./location-duplicate');
const { getSupabaseAdmin } = require('./server-supabase');

const META_KEY = 'rongmap:shared:meta';
let memoryMeta = { tags: [], activity: [], shareLinks: [], members: [] };

function toCamel(row = {}) {
  const tags = row.location_tags?.map((item) => item.tags).filter(Boolean) || row.tags || [];
  return {
    ...row,
    id: String(row.id),
    spaceId: row.space_id,
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

async function bootstrap(identity) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const all = await legacyStorage.getLocations();
    const meta = await getMeta();
    const locations = all.filter((item) => !item.deletedAt).map((item) => ({ ...item, id: String(item.id), version: item.version || 1, tags: item.tags || [] }));
    const trash = all.filter((item) => item.deletedAt).map((item) => ({ ...item, id: String(item.id), tags: item.tags || [] }));
    const members = meta.members?.length ? meta.members : [{ id: identity.user.id, name: identity.user.name, email: identity.user.email, role: 'admin', status: 'active' }];
    return { mode: 'legacy', currentUser: { ...identity.user, role: identity.role }, space: { id: identity.spaceId, name: '亲友共享地图', memberCount: members.length }, members, tags: meta.tags || [], locations, trash, activity: meta.activity || [], shareLinks: meta.shareLinks || [] };
  }
  const [spaceResult, locationResult, trashResult, tagResult, memberResult, activityResult, linkResult] = await Promise.all([
    supabase.from('spaces').select('*').eq('id', identity.spaceId).single(),
    supabase.from('locations').select('*, location_tags(tags(id,name))').eq('space_id', identity.spaceId).is('deleted_at', null).order('created_at', { ascending: false }).limit(5000),
    supabase.from('locations').select('*, location_tags(tags(id,name))').eq('space_id', identity.spaceId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(500),
    supabase.from('tags').select('*').eq('space_id', identity.spaceId).order('name'),
    supabase.from('space_members').select('user_id,role,status,profiles!space_members_user_id_fkey(name,email)').eq('space_id', identity.spaceId),
    supabase.from('activity_logs').select('*').eq('space_id', identity.spaceId).order('created_at', { ascending: false }).limit(300),
    supabase.from('share_links').select('id,label,created_at,revoked_at,last_accessed_at').eq('space_id', identity.spaceId).order('created_at', { ascending: false })
  ]);
  const firstError = [spaceResult, locationResult, trashResult, tagResult, memberResult, activityResult, linkResult].find((item) => item.error)?.error;
  if (firstError) throw firstError;
  return {
    mode: 'supabase',
    currentUser: { ...identity.user, role: identity.role },
    space: { id: spaceResult.data.id, name: spaceResult.data.name, memberCount: memberResult.data.length },
    members: memberResult.data.map((item) => ({ id: item.user_id, name: item.profiles?.name || item.profiles?.email?.split('@')[0] || '空间成员', email: item.profiles?.email || '', role: item.role, status: item.status })),
    tags: tagResult.data,
    locations: locationResult.data.map(toCamel),
    trash: trashResult.data.map(toCamel),
    activity: activityResult.data.map((item) => ({ id: item.id, actorId: item.actor_id, actorName: item.actor_name, action: item.action, targetName: item.target_name, summary: item.summary, createdAt: item.created_at })),
    shareLinks: linkResult.data.map((item) => ({ id: item.id, label: item.label, createdAt: item.created_at, revokedAt: item.revoked_at, lastAccessedAt: item.last_accessed_at }))
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

module.exports = { bootstrap, createLocation, updateLocation, softDelete, restoreLocation, purgeLocation, addActivity, getMeta, saveMeta, toCamel, validateLocation };
