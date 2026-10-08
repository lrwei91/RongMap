import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { registerSupabaseMember, findAuthUser } = require('./member-registration');
const identity = { spaceId: 'test-space', user: { id: 'test-admin' }, role: 'admin' };
const originalPassword = process.env.RONGMAP_DEFAULT_MEMBER_PASSWORD;
afterEach(() => {
  if (originalPassword === undefined) delete process.env.RONGMAP_DEFAULT_MEMBER_PASSWORD;
  else process.env.RONGMAP_DEFAULT_MEMBER_PASSWORD = originalPassword;
});

function database() {
  process.env.RONGMAP_DEFAULT_MEMBER_PASSWORD = 'test-password-only';
  const state = { users: [], profiles: new Map(), members: [], failProfile: false, failMembership: false };
  const client = {
    auth: { admin: {
      listUsers: vi.fn(async () => ({ data: { users: state.users }, error: null })),
      createUser: vi.fn(async (input) => {
        const user = { id: 'test-new-user', email: input.email, app_metadata: input.app_metadata };
        state.users.push(user);
        return { data: { user }, error: null };
      })
    } },
    from: vi.fn((table) => {
      let input; let options; let single = false;
      const filters = [];
      const query = {
        select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
        upsert(value, opts) { input = value; options = opts; return this; },
        single() { single = true; return this; },
        async then(resolve, reject) {
          try {
            if (table === 'profiles' && input) {
              if (state.failProfile) { state.failProfile = false; return resolve({ error: { code: '42501' } }); }
              state.profiles.set(input.id, input);
            }
            if (table === 'space_members' && input) {
              if (state.failMembership) { state.failMembership = false; return resolve({ error: { code: 'network_failure' } }); }
              expect(options).toEqual({ onConflict: 'space_id,user_id', ignoreDuplicates: true });
              if (!state.members.some((item) => item.space_id === input.space_id && item.user_id === input.user_id)) state.members.push({ ...input, created_at: 'test-date' });
            }
            const rows = (table === 'profiles' ? [...state.profiles.values()] : state.members).filter((item) => filters.every(([key, value]) => item[key] === value));
            resolve({ data: single ? rows[0] : rows, error: null });
          } catch (error) { reject(error); }
        }
      };
      return query;
    })
  };
  return { client, state };
}

describe('recoverable member registration', () => {
  for (const failure of ['failProfile', 'failMembership']) it(`retries ${failure} without creating another Auth account`, async () => {
    const { client, state } = database(); state[failure] = true;
    await expect(registerSupabaseMember(client, identity, 'testfriend', 'Friend')).rejects.toBeDefined();
    expect(state.users).toHaveLength(1);
    const result = await registerSupabaseMember(client, identity, 'testfriend', 'Friend');
    expect(result.member).toMatchObject({ username: 'testfriend', role: 'member' });
    expect(state.profiles.size).toBe(1); expect(state.members).toHaveLength(1);
    expect(client.auth.admin.createUser).toHaveBeenCalledTimes(1);
  });

  it('returns a completed registration without overwriting its name or role', async () => {
    const { client, state } = database();
    await registerSupabaseMember(client, identity, 'testfriend', 'Original');
    state.members[0].role = 'admin';
    const result = await registerSupabaseMember(client, identity, 'testfriend', 'Changed');
    expect(result).toMatchObject({ created: false, member: { name: 'Original', role: 'admin' } });
    expect(state.members).toHaveLength(1);
  });

  it('does not take over a historical orphan without trusted registration ownership', async () => {
    const { client, state } = database();
    state.users.push({ id: 'legacy-user', email: 'testfriend@rongmap.local', user_metadata: { username: 'testfriend', rongmap_registration_space: identity.spaceId } });
    await expect(registerSupabaseMember(client, identity, 'testfriend', 'Friend')).rejects.toMatchObject({ status: 409, message: '该用户名的注册尚未完成，请联系管理员修复' });
    expect(state.profiles.size).toBe(0); expect(state.members).toHaveLength(0);
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('does not attach an account belonging to another space', async () => {
    const { client, state } = database();
    state.users.push({ id: 'other-user', email: 'testfriend@rongmap.local', app_metadata: { rongmap_registration_space: identity.spaceId } });
    state.members.push({ user_id: 'other-user', space_id: 'other-space', role: 'admin' });
    await expect(registerSupabaseMember(client, identity, 'testfriend', 'Friend')).rejects.toMatchObject({ status: 409 });
    expect(state.profiles.size).toBe(0); expect(state.members).toHaveLength(1);
  });

  it('reconciles an Auth creation conflict caused by a concurrent request', async () => {
    const { client, state } = database();
    client.auth.admin.createUser.mockImplementationOnce(async (input) => {
      state.users.push({ id: 'concurrent-user', email: input.email, app_metadata: input.app_metadata });
      return { error: { status: 422, code: 'email_exists' } };
    });
    await expect(registerSupabaseMember(client, identity, 'testfriend', 'Friend')).resolves.toMatchObject({ member: { id: 'concurrent-user' } });
    expect(state.members).toHaveLength(1);
  });

  it('does not misclassify every Auth validation error as a duplicate username', async () => {
    const { client } = database();
    client.auth.admin.createUser.mockResolvedValueOnce({ error: { status: 422, code: 'validation_failed', message: 'validation error' } });
    await expect(registerSupabaseMember(client, identity, 'testfriend', 'Friend')).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('searches beyond the first Auth user page', async () => {
    const listUsers = vi.fn().mockResolvedValueOnce({ data: { users: Array.from({ length: 1000 }, () => ({ email: 'other@example.test' })) } }).mockResolvedValueOnce({ data: { users: [{ id: 'later-user', email: 'testfriend@rongmap.local' }] } });
    await expect(findAuthUser({ auth: { admin: { listUsers } } }, 'testfriend@rongmap.local')).resolves.toMatchObject({ id: 'later-user' });
    expect(listUsers).toHaveBeenLastCalledWith({ page: 2, perPage: 1000 });
  });
});
