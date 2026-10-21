const { cloud } = require('./cloud');
const { normalizeCategory } = require('./constants');
const { normalizeText, isDuplicateLocation } = require('./duplicate');

const DEFAULT_SPACE_NAME = '亲友共享地图';
const ADDRESS_MAX = 240;
const NAME_MAX = 120;
const REASON_MAX = 240;
const COMMENT_MAX = 240;
const COMMENT_LIMIT = 500;
const LIST_LIMIT = 5000;
const TRASH_LIMIT = 500;
const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function unwrap(result) {
  if (!result || result.error) {
    const info = (result && result.error) || {};
    const error = new Error(info.message || '云服务请求失败');
    error.kind = info.kind;
    error.status = info.status;
    error.code = info.code;
    throw error;
  }
  return result.data;
}

function clip(value, limit) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, limit);
}

/**
 * identity 的形状由 resolveIdentity 固定产出：{ uid, space: { id, ... }, member }。
 * 注意它没有 spaceId 字段（原 Web 端的 identity 有，是从服务端下发的），少一次转换就会拿到
 * undefined：写入会带着空 space_id 落库，而各表的 RLS WITH CHECK 都是按 space_members.space_id
 * 关联的，空值必然判失败，报出来的是「new row violates row-level security policy」，
 * 从错误信息很难反推真因，所以在这里早失败、给一句能看懂的话。
 */
function requireSpaceId(identity) {
  const spaceId = identity && identity.space ? identity.space.id : null;
  if (spaceId === null || spaceId === undefined || spaceId === '') {
    throw Object.assign(new Error('当前登录身份缺少空间信息，请重新登录'), { status: 401 });
  }
  return spaceId;
}

/** 把 locations 行（含内联 location_tags）转成页面使用的 camelCase 结构。 */
function locationFromRow(row) {
  const source = row || {};
  const tags = (source.location_tags || [])
    .map(function (link) { return link.tags; })
    .filter(Boolean)
    .map(function (tag) { return { id: String(tag.id), name: tag.name }; });
  return {
    id: String(source.id),
    spaceId: source.space_id,
    name: source.name,
    address: source.address || '',
    category: source.category,
    reason: source.reason || '',
    latitude: source.latitude == null ? null : Number(source.latitude),
    longitude: source.longitude == null ? null : Number(source.longitude),
    sourceId: source.source_id || '',
    sourceType: source.source_type || 'manual',
    sourcePlatform: source.source_platform || '',
    sourceContent: source.source_content || '',
    matchType: source.match_type || '',
    poiType: source.poi_type || '',
    normalizedAddress: source.normalized_address || '',
    city: source.city || '',
    district: source.district || '',
    confidence: source.confidence,
    ruleDecision: source.rule_decision,
    version: Number(source.version || 1),
    createdBy: source.created_by,
    createdByName: source.created_by_name,
    updatedBy: source.updated_by,
    deletedAt: source.deleted_at,
    deletedByName: source.deleted_by_name,
    tags: tags,
    createdAt: source.created_at,
    updatedAt: source.updated_at
  };
}

function memberFromRow(row) {
  const source = row || {};
  return {
    id: source.owner_id,
    name: source.name || '空间成员',
    role: source.role || 'member',
    createdAt: source.created_at
  };
}

/** 把 location_comments 行转成页面使用的 camelCase 结构。 */
function commentFromRow(row) {
  const source = row || {};
  return {
    id: String(source.id),
    locationId: source.location_id == null ? '' : String(source.location_id),
    authorId: source.owner_id,
    authorName: source.author_name || '空间成员',
    content: source.content || '',
    images: sanitizeImages(source.images),
    createdAt: source.created_at
  };
}

/**
 * images 列（jsonb）→ 干净的 path 数组：字符串 JSON 兜底解析、过滤非字符串、最多 3 张。
 * 上限与 utils/media.js 的 MAX_COMMENT_IMAGES 保持一致（那边管选择器，这边管落库）。
 */
function sanitizeImages(value) {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (error) {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.filter(function (item) {
    return typeof item === 'string' && item;
  }).slice(0, 3);
}

function spaceFromRow(row) {
  const source = row || {};
  return { id: source.id, name: source.name || DEFAULT_SPACE_NAME, createdAt: source.created_at };
}

function validateLocation(input) {
  // 表单已移除地址输入框，地址只在「地图选点」时自动带入，因此不再作为必填项；
  // 名称仍是硬性必填（库里 NOT NULL，列表与地图气泡也都靠它辨认）。
  if (!String(input.name || '').trim()) {
    const error = new Error('名称不能为空');
    error.status = 400;
    throw error;
  }
  const latitude = input.latitude === '' || input.latitude == null ? null : Number(input.latitude);
  const longitude = input.longitude === '' || input.longitude == null ? null : Number(input.longitude);
  if (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    throw Object.assign(new Error('纬度必须在 -90 到 90 之间'), { status: 400 });
  }
  if (longitude != null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw Object.assign(new Error('经度必须在 -180 到 180 之间'), { status: 400 });
  }
}

/** 与 Web 端 toDb 对齐；空格与大小写归一后落库，作为判重输入。 */
function locationToRow(input, identity, existing) {
  const prior = existing || {};
  const address = String(input.address != null ? input.address : prior.address || '').trim().slice(0, ADDRESS_MAX);
  const row = {
    space_id: requireSpaceId(identity),
    name: String(input.name != null ? input.name : prior.name || '').trim().slice(0, NAME_MAX),
    address: address,
    category: normalizeCategory(input.category, prior.category || 'food'),
    reason: String(input.reason != null ? input.reason : prior.reason || '').trim().slice(0, REASON_MAX),
    latitude: input.latitude === '' || input.latitude == null ? null : Number(input.latitude),
    longitude: input.longitude === '' || input.longitude == null ? null : Number(input.longitude),
    normalized_address: normalizeText(address),
    updated_by: identity.uid,
    updated_at: new Date().toISOString(),
    // city/district 是 areAdministrativeAreasCompatible 的输入，必须落库，否则判重会退化。
    city: clip(input.city !== undefined ? input.city : prior.city, 40),
    district: clip(input.district !== undefined ? input.district : prior.district, 40),
    poi_type: clip(input.poiType !== undefined ? input.poiType : prior.poiType, 120),
    source_id: clip(input.sourceId !== undefined ? input.sourceId : prior.sourceId, 80),
    source_type: clip(input.sourceType !== undefined ? input.sourceType : (prior.sourceType || 'manual'), 40),
    source_platform: clip(input.sourcePlatform !== undefined ? input.sourcePlatform : (prior.sourcePlatform || 'miniprogram'), 40),
    match_type: clip(input.matchType !== undefined ? input.matchType : prior.matchType, 40)
  };
  const confidence = input.confidence !== undefined ? input.confidence : prior.confidence;
  row.confidence = confidence === null || confidence === undefined || confidence === '' ? null : Number(confidence);
  if (!Number.isFinite(row.confidence)) row.confidence = null;
  return row;
}

function trashCutoff(now) {
  return new Date((now || Date.now()) - TRASH_RETENTION_MS).toISOString();
}

/** 空间/成员解析：单空间部署，首个进入者成为管理员。 */
async function resolveIdentity(displayName) {
  const session = unwrap(await cloud.auth.getSession());
  if (!session) throw Object.assign(new Error('登录已失效，请重新登录'), { status: 401 });
  const uid = session.user.id;

  let spaceRows = unwrap(await cloud.database.from('spaces').select('*').order('id', { ascending: true }).limit(1));
  let space = spaceRows[0];
  let createdSpace = false;
  if (!space) {
    const inserted = unwrap(await cloud.database.from('spaces').insert({ name: DEFAULT_SPACE_NAME }).select());
    space = inserted[0];
    createdSpace = true;
  }

  const mine = unwrap(await cloud.database
    .from('space_members').select('*')
    .eq('space_id', space.id).eq('owner_id', uid).limit(1));
  if (mine.length) {
    return { uid: uid, space: spaceFromRow(space), member: memberFromRow(mine[0]), createdSpace: false };
  }

  const others = unwrap(await cloud.database
    .from('space_members').select('id').eq('space_id', space.id).limit(1));
  const role = createdSpace || others.length === 0 ? 'admin' : 'member';
  const name = String(displayName || '').trim().slice(0, 40) || '空间成员';
  const inserted = unwrap(await cloud.database
    .from('space_members').insert({ space_id: space.id, name: name, role: role }).select());
  return { uid: uid, space: spaceFromRow(space), member: memberFromRow(inserted[0]), createdSpace: true };
}

/**
 * 只查不建：当前微信账号是否已在空间里有一条成员记录。
 * 登录页用它区分「老成员直接进」和「首次进来先完善称呼」——
 * 如果不先查，resolveIdentity 会用兜底名直接把成员建出来，称呼环节就永远没机会出现。
 */
async function hasMembership() {
  const session = unwrap(await cloud.auth.getSession());
  if (!session) return false;
  const uid = session.user.id;
  const spaceRows = unwrap(await cloud.database
    .from('spaces').select('id').order('id', { ascending: true }).limit(1));
  const space = spaceRows[0];
  if (!space) return false;
  const mine = unwrap(await cloud.database
    .from('space_members').select('id')
    .eq('space_id', space.id).eq('owner_id', uid).limit(1));
  return mine.length > 0;
}

async function listMembers(spaceId) {
  const rows = unwrap(await cloud.database
    .from('space_members').select('*').eq('space_id', spaceId).order('id', { ascending: true }));
  return rows.map(memberFromRow);
}

async function listTags(spaceId) {
  const rows = unwrap(await cloud.database
    .from('tags').select('*').eq('space_id', spaceId).order('name', { ascending: true }));
  return rows.map(function (row) { return { id: String(row.id), name: row.name }; });
}

async function listLocations(spaceId) {
  const rows = unwrap(await cloud.database
    .from('locations').select('*, location_tags(tags(id,name))')
    .eq('space_id', spaceId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(LIST_LIMIT));
  return rows.map(locationFromRow);
}

async function listTrash(spaceId) {
  const rows = unwrap(await cloud.database
    .from('locations').select('*, location_tags(tags(id,name))')
    .eq('space_id', spaceId).not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false }).limit(TRASH_LIMIT));
  return rows.map(locationFromRow);
}

async function listActivity(spaceId) {
  const rows = unwrap(await cloud.database
    .from('activity_logs').select('*').eq('space_id', spaceId)
    .order('created_at', { ascending: false }).limit(300));
  return rows.map(function (row) {
    return {
      id: String(row.id),
      actorId: row.owner_id,
      actorName: row.actor_name || '空间成员',
      action: row.action,
      targetName: row.target_name || '',
      summary: row.summary || '',
      createdAt: row.created_at
    };
  });
}

/**
 * 某个地点下的点评：按时间正序（先写的在上），全空间成员可见。
 */
async function listComments(spaceId, locationId) {
  const rows = unwrap(await cloud.database
    .from('location_comments').select('*')
    .eq('space_id', spaceId).eq('location_id', locationId)
    .order('created_at', { ascending: true }).limit(COMMENT_LIMIT));
  return rows.map(commentFromRow);
}

// 回收站保留 30 天：到期必须真正清理，而不是只显示倒计时。
// 采用惰性清理——由 bootstrap 触发，无需定时任务；失败不影响主流程。
async function purgeExpiredTrash(spaceId) {
  const cutoff = trashCutoff();
  const removed = unwrap(await cloud.database
    .from('locations').delete()
    .eq('space_id', spaceId).not('deleted_at', 'is', null).lt('deleted_at', cutoff)
    .select('id'));
  return Array.isArray(removed) ? removed.length : 0;
}

async function addActivity(identity, action, targetName) {
  try {
    await cloud.database.from('activity_logs').insert({
      space_id: identity.space.id,
      actor_name: identity.member.name,
      action: action,
      target_name: String(targetName || '').slice(0, 120)
    });
  } catch (error) {
    // 活动记录失败不应阻断主流程。
    console.warn('[RongMap] activity log failed', action);
  }
}

async function syncTags(locationId, tagIds) {
  await cloud.database.from('location_tags').delete().eq('location_id', locationId);
  if (tagIds && tagIds.length) {
    await cloud.database.from('location_tags').insert(tagIds.map(function (tagId) {
      return { location_id: locationId, tag_id: tagId };
    }));
  }
}

async function bootstrap(identity) {
  await purgeExpiredTrash(identity.space.id).catch(function () { return 0; });
  const results = await Promise.all([
    listMembers(identity.space.id),
    listTags(identity.space.id),
    listLocations(identity.space.id),
    listTrash(identity.space.id),
    listActivity(identity.space.id)
  ]);
  return {
    currentUser: { id: identity.uid, name: identity.member.name, role: identity.member.role },
    space: identity.space,
    members: results[0],
    tags: results[1],
    locations: results[2],
    trash: results[3],
    activity: results[4]
  };
}

async function createLocation(identity, input) {
  requireSpaceId(identity);
  validateLocation(input);
  const candidate = Object.assign({}, input, { createdBy: identity.uid });
  const existing = await listLocations(identity.space.id);
  const duplicate = isDuplicateLocation(candidate, existing);
  if (duplicate.isDuplicate) {
    const error = new Error('该地点已在共享空间中收藏');
    error.status = 409;
    error.existing = duplicate.existing;
    throw error;
  }
  const row = locationToRow(input, identity);
  row.created_by = identity.uid;
  row.created_by_name = identity.member.name;
  const inserted = unwrap(await cloud.database.from('locations').insert(row).select());
  const created = inserted[0];
  if (Array.isArray(input.tagIds)) await syncTags(created.id, input.tagIds);
  await addActivity(identity, 'location_created', created.name);
  return locationFromRow(created);
}

async function updateLocation(identity, id, input) {
  requireSpaceId(identity);
  validateLocation(input);
  const updated = unwrap(await cloud.database
    .from('locations')
    .update(Object.assign(locationToRow(input, identity, input), { version: Number(input.version || 1) + 1 }))
    .eq('id', id).eq('space_id', identity.space.id).is('deleted_at', null)
    .eq('version', Number(input.version || 1))
    .select());
  if (!updated.length) {
    // RLS 过滤与版本不匹配都表现为空数组，取最新记录区分"不是你改的"与"版本落后"。
    const latest = unwrap(await cloud.database.from('locations').select('*').eq('id', id).limit(1));
    const error = new Error('地点已被其他成员修改');
    error.status = 409;
    error.latest = latest.length ? locationFromRow(latest[0]) : null;
    throw error;
  }
  // 未显式传 tagIds 时保持原有标签关联；传空数组才表示清空。
  if (Array.isArray(input.tagIds)) await syncTags(id, input.tagIds);
  await addActivity(identity, 'location_updated', updated[0].name);
  return locationFromRow(updated[0]);
}

async function softDeleteLocation(identity, id) {
  const updated = unwrap(await cloud.database
    .from('locations')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: identity.uid,
      deleted_by_name: identity.member.name
    })
    .eq('id', id).eq('space_id', identity.space.id).select());
  if (!updated.length) throw Object.assign(new Error('未找到该地点'), { status: 404 });
  await addActivity(identity, 'location_deleted', updated[0].name);
  return locationFromRow(updated[0]);
}

async function restoreLocation(identity, id) {
  const updated = unwrap(await cloud.database
    .from('locations')
    .update({ deleted_at: null, deleted_by: null, deleted_by_name: null })
    .eq('id', id).eq('space_id', identity.space.id).select());
  if (!updated.length) throw Object.assign(new Error('未找到该地点'), { status: 404 });
  await addActivity(identity, 'location_restored', updated[0].name);
  return locationFromRow(updated[0]);
}

async function purgeLocation(identity, id) {
  const removed = unwrap(await cloud.database
    .from('locations').delete()
    .eq('id', id).eq('space_id', identity.space.id).not('deleted_at', 'is', null).select());
  if (!removed.length) throw Object.assign(new Error('未找到该地点'), { status: 404 });
  return locationFromRow(removed[0]);
}

/**
 * 写一条点评（文字与图片至少要有一个）。author_name 是成员称呼的快照
 * （与 created_by_name / actor_name 同思路），之后成员改名不回改历史点评；
 * RLS 侧由 owner_id = auth.uid() 兜底，客户端不发送 owner_id。
 * locationName 只用于活动记录，缺省不影响点评落库。
 */
async function createComment(identity, locationId, content, locationName, imagePaths) {
  requireSpaceId(identity);
  const trimmed = String(content || '').trim().slice(0, COMMENT_MAX);
  const images = sanitizeImages(imagePaths);
  if (!trimmed && !images.length) {
    throw Object.assign(new Error('点评内容不能为空'), { status: 400 });
  }
  if (locationId === null || locationId === undefined || locationId === '') {
    throw Object.assign(new Error('缺少地点信息，请重新打开详情'), { status: 400 });
  }
  const inserted = unwrap(await cloud.database.from('location_comments').insert({
    space_id: identity.space.id,
    location_id: Number(locationId),
    author_name: identity.member.name,
    content: trimmed,
    images: images
  }).select());
  await addActivity(identity, 'comment_created', locationName || '地点');
  return commentFromRow(inserted[0]);
}

/** 删除点评：RLS 只允许删自己的，这里再加一层 owner 校验让错误信息更直白。 */
async function deleteComment(identity, id, authorId) {
  if (authorId && authorId !== identity.uid) {
    throw Object.assign(new Error('只能删除自己的点评'), { status: 403 });
  }
  const removed = unwrap(await cloud.database
    .from('location_comments').delete()
    .eq('id', id).eq('space_id', identity.space.id).select());
  if (!removed.length) throw Object.assign(new Error('未找到该点评'), { status: 404 });
  return commentFromRow(removed[0]);
}

/**
 * 一批点评的点赞汇总：一次 IN 查询拉全，返回 { [commentId]: { count, likedByMe } }。
 * commentIds 为空时直接返回，不发请求。
 */
async function listCommentLikes(spaceId, commentIds, uid) {
  const ids = (commentIds || []).map(function (id) {
    return Number(id);
  }).filter(function (id) {
    return Number.isFinite(id);
  });
  const summary = {};
  ids.forEach(function (id) {
    summary[id] = { count: 0, likedByMe: false };
  });
  if (!ids.length) return summary;
  const rows = unwrap(await cloud.database
    .from('comment_likes').select('comment_id, owner_id')
    .eq('space_id', spaceId).in('comment_id', ids));
  rows.forEach(function (row) {
    const key = Number(row.comment_id);
    if (!summary[key]) summary[key] = { count: 0, likedByMe: false };
    summary[key].count += 1;
    if (row.owner_id === uid) summary[key].likedByMe = true;
  });
  return summary;
}

/**
 * 点赞/取消点赞（幂等）：插入撞唯一约束（23505）视为「已点赞」成功，
 * 取消时删除本人那条（RLS 也是本人可删）。
 */
async function toggleCommentLike(identity, commentId, liked) {
  requireSpaceId(identity);
  const id = Number(commentId);
  if (!Number.isFinite(id)) {
    throw Object.assign(new Error('缺少点评信息'), { status: 400 });
  }
  if (liked) {
    try {
      unwrap(await cloud.database.from('comment_likes')
        .insert({ space_id: identity.space.id, comment_id: id }).select());
    } catch (error) {
      if (String(error.code) !== '23505') throw error;
    }
    return { commentId: String(id), liked: true };
  }
  unwrap(await cloud.database.from('comment_likes').delete()
    .eq('space_id', identity.space.id).eq('comment_id', id).select());
  return { commentId: String(id), liked: false };
}

async function createTag(identity, name) {
  const trimmed = String(name || '').trim().slice(0, 24);
  if (!trimmed) throw Object.assign(new Error('标签名称不能为空'), { status: 400 });
  const inserted = unwrap(await cloud.database
    .from('tags').insert({ space_id: identity.space.id, name: trimmed }).select());
  return { id: String(inserted[0].id), name: inserted[0].name };
}

async function deleteTag(identity, id) {
  const removed = unwrap(await cloud.database
    .from('tags').delete().eq('id', id).eq('space_id', identity.space.id).select());
  if (!removed.length) throw Object.assign(new Error('未找到该标签'), { status: 404 });
  return { id: String(removed[0].id), name: removed[0].name };
}

async function updateMember(identity, memberId, patch) {
  const row = {};
  if (patch.name !== undefined) row.name = String(patch.name).trim().slice(0, 40) || '空间成员';
  if (patch.role !== undefined) row.role = patch.role === 'admin' ? 'admin' : 'member';
  // memberFromRow 把成员的 id 映射成 owner_id（页面用它和 uid 比对判断「是不是我」），
  // 所以这里按 owner_id 过滤。space_members.id 是 bigint 自增列，拿它比对 uid 字符串会直接报
  // invalid input syntax for type bigint。
  const updated = unwrap(await cloud.database
    .from('space_members').update(row)
    .eq('owner_id', memberId).eq('space_id', identity.space.id).select());
  if (!updated.length) throw Object.assign(new Error('未找到该成员'), { status: 404 });
  return memberFromRow(updated[0]);
}

async function removeMember(identity, memberId) {
  const removed = unwrap(await cloud.database
    .from('space_members').delete()
    .eq('owner_id', memberId).eq('space_id', identity.space.id).select());
  if (!removed.length) throw Object.assign(new Error('未找到该成员'), { status: 404 });
  return memberFromRow(removed[0]);
}

async function bulkTag(identity, ids, tagId) {
  for (let index = 0; index < ids.length; index += 1) {
    await cloud.database.from('location_tags').upsert(
      { location_id: ids[index], tag_id: tagId },
      { ignoreDuplicates: true }
    );
  }
  await addActivity(identity, 'bulk_updated', ids.length + ' 个地点');
  return ids.length;
}

async function bulkTrash(identity, ids) {
  const now = new Date().toISOString();
  const updated = unwrap(await cloud.database
    .from('locations')
    .update({ deleted_at: now, deleted_by: identity.uid, deleted_by_name: identity.member.name })
    .in('id', ids).eq('space_id', identity.space.id).select('id'));
  await addActivity(identity, 'bulk_updated', (updated || []).length + ' 个地点移入回收站');
  return (updated || []).length;
}

module.exports = {
  unwrap,
  locationFromRow,
  memberFromRow,
  commentFromRow,
  resolveIdentity,
  hasMembership,
  bootstrap,
  listMembers,
  listTags,
  listLocations,
  listTrash,
  listActivity,
  listComments,
  listCommentLikes,
  createLocation,
  updateLocation,
  softDeleteLocation,
  restoreLocation,
  purgeLocation,
  createComment,
  deleteComment,
  toggleCommentLike,
  sanitizeImages,
  createTag,
  deleteTag,
  updateMember,
  removeMember,
  bulkTag,
  bulkTrash,
  DEFAULT_SPACE_NAME,
  COMMENT_MAX,
  TRASH_RETENTION_DAYS
};
