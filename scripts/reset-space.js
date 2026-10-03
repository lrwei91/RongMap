require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' });
const { getSupabaseAdmin } = require('../lib/server-supabase');

// 清空 Supabase 侧全部空间数据（地点、成员、空间、账号），随后用 npm run migrate:shared 重建。
// 不可逆：执行前先跑 npm run backup:kv，旧地点仍留在 KV/本地 JSON 里，可由迁移脚本重新导入。
async function main() {
  const confirmed = process.argv.includes('--yes');
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error('请配置 SUPABASE_URL 与 SUPABASE_SECRET_KEY');

  const allUsers = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    allUsers.push(...result.data.users);
    if (result.data.users.length < 1000) break;
  }
  const countOf = async (table) => {
    const result = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (result.error) throw result.error;
    return result.count || 0;
  };
  const counts = {
    spaces: await countOf('spaces'),
    members: await countOf('space_members'),
    locations: await countOf('locations'),
    trips: await countOf('trips'),
    accounts: allUsers.length
  };
  console.log(JSON.stringify({ dryRun: !confirmed, counts }, null, 2));
  if (!confirmed) {
    console.log('这是演练。确认已备份后，用 npm run reset:space -- --yes 真正清空。');
    return;
  }

  const membership = await supabase.from('space_members').delete().neq('space_id', '00000000-0000-0000-0000-000000000000');
  if (membership.error) throw membership.error;
  // 删空间会级联清理 locations、tags、trips、share_links、import_sessions 和 activity_logs。
  const space = await supabase.from('spaces').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (space.error) throw space.error;
  const deletedAccounts = [];
  for (const user of allUsers) {
    const result = await supabase.auth.admin.deleteUser(user.id);
    if (result.error) throw result.error;
    deletedAccounts.push(user.email || user.id);
  }
  console.log(JSON.stringify({ success: true, counts, deletedAccounts, next: 'npm run migrate:shared' }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });