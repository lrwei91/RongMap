require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' });
const crypto = require('crypto');
const { getSupabaseAdmin } = require('../lib/server-supabase');
const storage = require('../lib/locations-storage');

async function main() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error('请配置 SUPABASE_URL 与 SUPABASE_SECRET_KEY');
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
  if (!adminEmail) throw new Error('请配置 INITIAL_ADMIN_EMAIL');
  const users = await supabase.auth.admin.listUsers();
  if (users.error) throw users.error;
  const admin = users.data.users.find((user) => user.email?.toLowerCase() === adminEmail.toLowerCase());
  if (!admin) throw new Error(`Supabase Auth 中未找到管理员邮箱 ${adminEmail}`);
  const profile = { id: admin.id, email: admin.email, name: admin.user_metadata?.name || admin.email.split('@')[0] };
  await supabase.from('profiles').upsert(profile);
  const configuredSpaceId = process.env.RONGMAP_DEFAULT_SPACE_ID;
  const spaceId = configuredSpaceId || crypto.randomUUID();
  const spaceResult = await supabase.from('spaces').upsert({ id: spaceId, name: process.env.RONGMAP_DEFAULT_SPACE_NAME || '亲友共享地图', created_by: admin.id }).select().single();
  if (spaceResult.error) throw spaceResult.error;
  await supabase.from('space_members').upsert({ space_id: spaceId, user_id: admin.id, role: 'admin', status: 'active' }, { onConflict: 'space_id,user_id' });
  const locations = await storage.getLocations();
  const rows = locations.map((item) => ({
    id: /^[0-9a-f-]{36}$/i.test(String(item.id)) ? item.id : crypto.randomUUID(),
    space_id: spaceId,
    name: item.name,
    address: item.address,
    reason: item.reason || '',
    category: ['food','spot','cafe_bar'].includes(item.category) ? item.category : 'food',
    latitude: item.latitude == null ? null : Number(item.latitude),
    longitude: item.longitude == null ? null : Number(item.longitude),
    source_id: item.sourceId || null,
    source_type: item.sourceType || 'manual',
    source_platform: item.sourcePlatform || 'web',
    source_content: item.sourceContent || null,
    normalized_address: item.normalizedAddress || null,
    city: item.city || null,
    district: item.district || null,
    confidence: item.confidence || null,
    version: 1,
    created_by: admin.id,
    created_by_name: profile.name,
    created_at: item.createdAt || new Date().toISOString(),
    updated_at: item.createdAt || new Date().toISOString()
  }));
  for (let index = 0; index < rows.length; index += 200) {
    const result = await supabase.from('locations').upsert(rows.slice(index, index + 200), { onConflict: 'id' });
    if (result.error) throw result.error;
  }
  console.log(JSON.stringify({ success: true, spaceId, migrated: rows.length }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
