import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
    auth: { persistSession: true, detectSessionInUrl: false, autoRefreshToken: true }
  })
  : null;

export async function getAccessToken() {
  if (!supabase) return '';
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

// 登录只填用户名：服务端换取会话后写回本地会话，后续鉴权和实时订阅都沿用原链路。
export async function signInWithUsername(username) {
  const response = await fetch('/api/v2/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '登录失败');
    error.status = response.status;
    throw error;
  }
  if (!supabase) return data;
  const { error } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
  if (error) throw new Error('登录会话初始化失败');
  return data;
}