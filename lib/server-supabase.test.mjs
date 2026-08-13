import { afterEach, describe, expect, it } from 'vitest';
import serverSupabase from './server-supabase.js';

const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  RONGMAP_LEGACY_MODE: process.env.RONGMAP_LEGACY_MODE
};

function clearSupabaseEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RONGMAP_LEGACY_MODE;
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Supabase 身份降级', () => {
  it('未配置 Supabase 时默认关闭管理员身份', async () => {
    clearSupabaseEnv();

    await expect(serverSupabase.getRequestIdentity({ headers: {} })).rejects.toMatchObject({
      status: 503,
      message: '登录服务尚未配置'
    });
  });

  it('仅显式启用时保留本地旧版身份', async () => {
    clearSupabaseEnv();
    process.env.RONGMAP_LEGACY_MODE = '1';

    await expect(serverSupabase.getRequestIdentity({ headers: {} })).resolves.toMatchObject({
      mode: 'legacy',
      role: 'admin'
    });
  });
});
