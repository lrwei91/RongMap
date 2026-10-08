import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const server = require('./server-supabase');
const sessionHandler = require('./api-v2/session');

describe('login and administrative client isolation', () => {
  it('keeps privileged database requests privileged after signing in a member', async () => {
    const keys = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VITE_SUPABASE_ANON_KEY', 'RONGMAP_DEFAULT_MEMBER_PASSWORD'];
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.SUPABASE_URL = 'https://isolation-test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'fixture-service-role-key';
    process.env.VITE_SUPABASE_ANON_KEY = 'fixture-anon-key';
    process.env.RONGMAP_DEFAULT_MEMBER_PASSWORD = 'fixture-password';
    const requests = [];
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: 'fixture-user', role: 'authenticated' })).toString('base64url');
    const token = `fixture.${payload}.fixture`;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      requests.push({ url: String(url), authorization: new Headers(options.headers).get('authorization') });
      const body = String(url).includes('/auth/v1/token')
        ? { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user: { id: 'fixture-user', email: 'testfriend@rongmap.local' } }
        : String(url).includes('/rest/v1/space_members') ? [{ space_id: 'test-space' }] : [];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    try {
      const admin = server.getSupabaseAdmin();
      const login = server.createSupabaseLoginClient();
      expect(login).not.toBe(admin);
      expect(server.createSupabaseLoginClient()).not.toBe(login);
      await admin.from('profiles').select('id');
      const result = await login.auth.signInWithPassword({ email: 'testfriend@rongmap.local', password: 'fixture-password' });
      expect(result.error).toBeNull();
      await login.from('profiles').select('id');
      const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await sessionHandler({ method: 'POST', body: { username: 'testfriend' } }, response);
      expect(response.statusCode).toBe(200);
      await admin.from('profiles').upsert({ id: 'fixture-new-member', email: 'testfriend@rongmap.local', name: 'Friend' });
      const databaseRequests = requests.filter((item) => item.url.includes('/rest/v1/'));
      expect(databaseRequests.map((item) => item.authorization)).toEqual([
        'Bearer fixture-service-role-key', `Bearer ${token}`, 'Bearer fixture-service-role-key', 'Bearer fixture-service-role-key'
      ]);
    } finally {
      fetch.mockRestore();
      for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
    }
  });
});
