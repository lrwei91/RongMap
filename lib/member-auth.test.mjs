import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { getDefaultMemberPassword, normalizeUsername, toMemberEmail, memberUsername, signInMember } = require('./member-auth');

describe('username-only login', () => {
  it('requires a server-side default password', () => {
    expect(() => getDefaultMemberPassword({})).toThrow('成员默认密码尚未配置');
    expect(() => getDefaultMemberPassword({ RONGMAP_DEFAULT_MEMBER_PASSWORD: 'short' })).toThrow('至少需要 8 个字符');
  });

  it('maps usernames to a stable pseudo email', () => {
    expect(toMemberEmail(' Afu ')).toBe('afu@rongmap.local');
    expect(memberUsername('afu@rongmap.local')).toBe('afu');
  });

  it('rejects usernames that would break the pseudo email mapping', () => {
    expect(() => normalizeUsername('a')).toThrow('用户名需为 3-40 位');
    expect(() => normalizeUsername('阿福')).toThrow('用户名需为 3-40 位');
    expect(() => normalizeUsername('afu@rongmap.local')).toThrow('用户名需为 3-40 位');
    expect(normalizeUsername('xiaorong')).toBe('xiaorong');
  });

  it('exchanges the shared password for a session and reports unknown usernames as null', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    const environment = { RONGMAP_DEFAULT_MEMBER_PASSWORD: 'safe-pass-123' };
    expect(await signInMember({ auth: { signInWithPassword } }, 'afu@rongmap.local', environment)).toEqual({ access_token: 'token' });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'afu@rongmap.local', password: 'safe-pass-123' });
    expect(await signInMember({ auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } }) } }, 'nobody@rongmap.local', environment)).toBeNull();
  });
});