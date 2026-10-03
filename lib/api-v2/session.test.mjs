import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const session = require('./session');

const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  RONGMAP_DEFAULT_MEMBER_PASSWORD: process.env.RONGMAP_DEFAULT_MEMBER_PASSWORD
};

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    json(body) { this.body = body; return this; }
  };
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://demo.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'service-role-key';
  process.env.RONGMAP_DEFAULT_MEMBER_PASSWORD = 'safe-pass-123';
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('用户名登录入口', () => {
  it('没有用户名时直接拒绝，不触碰 Supabase', async () => {
    const res = createResponse();
    await session({ method: 'POST', body: { username: '  ' } }, res);
    expect(res).toMatchObject({ statusCode: 400, body: { error: '请输入用户名' } });
  });

  it('未配置登录服务时返回 503', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;
    const res = createResponse();
    await session({ method: 'POST', body: { username: 'afu' } }, res);
    expect(res.statusCode).toBe(503);
  });

  it('只接受 POST', async () => {
    const res = createResponse();
    await session({ method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
  });
});