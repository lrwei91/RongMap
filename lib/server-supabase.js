const { createClient } = require('@supabase/supabase-js');

let client;

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  if (!client) {
    client = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return client;
}

function getBearerToken(req) {
  const value = req.headers?.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

async function getRequestIdentity(req) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    if (process.env.RONGMAP_LEGACY_MODE !== '1') {
      const error = new Error('登录服务尚未配置');
      error.status = 503;
      throw error;
    }
    return {
      mode: 'legacy',
      user: { id: 'legacy-admin', email: process.env.INITIAL_ADMIN_EMAIL || '', name: '空间管理员' },
      role: 'admin',
      spaceId: process.env.RONGMAP_DEFAULT_SPACE_ID || 'default'
    };
  }
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error('登录已失效，请重新登录');
    error.status = 401;
    throw error;
  }
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    const error = new Error('登录已失效，请重新登录');
    error.status = 401;
    throw error;
  }
  const requestedSpaceId = req.headers?.['x-rongmap-space-id'] || req.query?.spaceId;
  let query = supabase.from('space_members').select('space_id, role, status').eq('user_id', userData.user.id);
  if (requestedSpaceId) query = query.eq('space_id', requestedSpaceId);
  const { data: memberships, error: membershipError } = await query.limit(1);
  if (membershipError || !memberships?.length) {
    const error = new Error('你不是该共享空间的成员');
    error.status = 403;
    throw error;
  }
  if (memberships[0].status === 'invited') {
    const activation = await supabase.from('space_members').update({ status: 'active' }).eq('space_id', memberships[0].space_id).eq('user_id', userData.user.id);
    if (activation.error) throw activation.error;
    memberships[0].status = 'active';
  }
  return {
    mode: 'supabase',
    user: {
      id: userData.user.id,
      email: userData.user.email || '',
      name: userData.user.user_metadata?.name || userData.user.email?.split('@')[0] || '空间成员'
    },
    role: memberships[0].role,
    spaceId: memberships[0].space_id
  };
}

function requireAdmin(identity) {
  if (identity.role !== 'admin') {
    const error = new Error('只有管理员可以执行此操作');
    error.status = 403;
    throw error;
  }
}

async function getServiceIdentity() {
  const supabase = getSupabaseAdmin();
  const spaceId = process.env.RONGMAP_DEFAULT_SPACE_ID || 'default';
  if (!supabase) {
    if (process.env.RONGMAP_LEGACY_MODE !== '1') {
      const error = new Error('登录服务尚未配置');
      error.status = 503;
      throw error;
    }
    return { mode: 'legacy', user: { id: 'openclaw', email: '', name: 'OpenClaw' }, role: 'member', spaceId };
  }
  if (!process.env.RONGMAP_DEFAULT_SPACE_ID) {
    const error = new Error('OpenClaw 需要配置 RONGMAP_DEFAULT_SPACE_ID');
    error.status = 500;
    throw error;
  }
  const { data, error } = await supabase.from('space_members').select('user_id,profiles(name,email)').eq('space_id', spaceId).eq('role', 'admin').eq('status', 'active').limit(1);
  if (error || !data?.length) throw error || new Error('默认空间没有可用管理员');
  return { mode: 'supabase', user: { id: data[0].user_id, name: 'OpenClaw', email: data[0].profiles?.email || '' }, role: 'member', spaceId };
}

module.exports = { getSupabaseAdmin, getRequestIdentity, getServiceIdentity, requireAdmin };
