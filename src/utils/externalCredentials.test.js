import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { randomUUID, webcrypto } from 'node:crypto';

const source = stripTypeScriptTypes(
  (
    await readFile(
      new URL(
        '../../supabase/functions/user-credentials/index.ts',
        import.meta.url,
      ),
      'utf8',
    )
  ).replace(/^import .*\n/, ''),
);

const setup = ({
  role = 'superadmin',
  gated = false,
  revoked = false,
  action = 'provision',
  conflict = false,
} = {}) => {
  const actor = {
    id: 'actor',
    auth_id: 'actor-auth',
    email: 'actor@example.invalid',
    role,
    status: revoked ? 'Released' : 'Active',
    must_change_password: gated,
  };
  const target = {
    id: 'external',
    auth_id: action === 'reset' ? 'external-auth' : null,
    email: 'external@example.invalid',
    name: 'Test Observer',
    role: 'observer',
    status: 'Active',
    must_change_password: false,
  };
  const calls = [];
  let handler;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'actor-auth' } } }),
      signInWithPassword: async () => ({
        data: { user: { id: 'actor-auth' } },
      }),
      signOut: async () => ({}),
      admin: {
        listUsers: async () => ({
          data: {
            users: conflict ? [{ id: 'staff-auth', email: target.email }] : [],
          },
        }),
        createUser: async (args) => {
          calls.push({ operation: 'createUser', args });
          return { data: { user: { id: 'new-auth' } } };
        },
        updateUserById: async (id, args) => {
          calls.push({ operation: 'updateAuth', id, args });
          return {};
        },
        deleteUser: async () => ({}),
      },
    },
    from: (table) => {
      const filters = {};
      let update;
      const execute = () => {
        calls.push({ table, filters, update });
        if (update) return { data: { id: filters.id } };
        if (filters.auth_id === 'actor-auth')
          return {
            data: (
              role === 'observer'
                ? table === 'external_accounts'
                : table === 'employees'
            )
              ? actor
              : null,
          };
        if (filters.id === 'external') return { data: target };
        if (filters.auth_id === 'staff-auth' && table === 'employees')
          return { data: { id: 'staff' } };
        return { data: null };
      };
      const query = {
        select: () => query,
        eq: (key, value) => {
          filters[key] = value;
          return query;
        },
        is: () => query,
        update: (value) => {
          update = value;
          return query;
        },
        maybeSingle: async () => execute(),
        then: (resolve) => Promise.resolve(execute()).then(resolve),
      };
      return query;
    },
  };
  vm.runInNewContext(source, {
    createClient: () => client,
    crypto: webcrypto,
    Response,
    Deno: {
      env: { get: () => 'synthetic-environment' },
      serve: (value) => {
        handler = value;
      },
    },
  });
  const request = (body) =>
    handler(
      new Request('https://example.invalid/credentials', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer synthetic-session',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );
  return { request, calls };
};

test('Superadmin provisions and resets an external login using the external table', async () => {
  for (const action of ['provision', 'reset']) {
    const { request, calls } = setup({ action });
    const response = await request({
      action,
      employeeId: 'external',
      accountType: 'external',
    });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).temporaryPassword);
    assert.ok(
      calls.some(
        (call) =>
          call.table === 'external_accounts' &&
          call.update?.must_change_password,
      ),
    );
    assert.equal(
      calls.some((call) => call.table === 'employees' && call.update),
      false,
    );
  }
});

test('Observer can replace their own temporary password without gaining staff permissions', async () => {
  const { request, calls } = setup({ role: 'observer', gated: true });
  const response = await request({
    action: 'complete-temporary-password',
    currentPassword: randomUUID(),
    newPassword: randomUUID(),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'password_changed');
  assert.ok(
    calls.some(
      (call) =>
        call.table === 'external_accounts' &&
        call.filters.id === 'actor' &&
        call.update?.must_change_password === false,
    ),
  );
  assert.ok(
    calls.some(
      (call) => call.operation === 'updateAuth' && call.id === 'actor-auth',
    ),
  );
  assert.equal(
    calls.some((call) => call.table === 'employees' && call.update),
    false,
  );
});

test('Observers, Admins, revoked and password-gated actors cannot issue credentials', async () => {
  for (const options of [
    { role: 'observer' },
    { role: 'admin' },
    { role: 'observer', revoked: true },
    { gated: true },
  ]) {
    const { request, calls } = setup(options);
    const response = await request({
      action: 'provision',
      employeeId: 'external',
      accountType: 'external',
    });
    assert.equal(response.status, 403);
    assert.equal(
      calls.some((call) => call.update || call.operation),
      false,
    );
  }
});

test('Provisioning refuses an Auth identity already linked to staff', async () => {
  const { request, calls } = setup({ conflict: true });
  const response = await request({
    action: 'provision',
    employeeId: 'external',
    accountType: 'external',
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'AUTH_USER_ALREADY_LINKED');
  assert.equal(
    calls.some((call) => call.update || call.operation),
    false,
  );
});
