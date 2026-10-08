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

// 登录会在客户端内保存用户会话，即使 persistSession 为 false。
// 必须每次创建独立客户端，不能污染共享管理员客户端的 Authorization。
function createSupabaseLoginClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
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
      user: { id: 'legacy-admin', email: process.env.INITIAL_ADMIN_USERNAME || '', name: '空间管理员' },
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
  // 空间归属完全由服务端按登录用户的 space_members 关系解析，不接受客户端指定 spaceId：
  // 早期版本读取过 x-rongmap-space-id / query.spaceId，但前端从未发送，且会让调用方误以为可越权选空间。
  const { data: memberships, error: membershipError } = await supabase
    .from('space_members').select('space_id, role').eq('user_id', userData.user.id).limit(1);
  if (membershipError || !memberships?.length) {
    const error = new Error('你不是该共享空间的成员');
    error.status = 403;
    throw error;
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

module.exports = { getSupabaseAdmin, createSupabaseLoginClient, getRequestIdentity, requireAdmin };
