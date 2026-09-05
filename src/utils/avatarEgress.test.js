import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  avatarPathForEmployee,
  cacheableAvatarUrl,
  dataUrlToBlob,
  isEmbeddedAvatar,
  storeEmployeeAvatar,
} from './avatars.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const avatarClient = (profileResult) => {
  const removed = [];
  const bucket = {
    upload: async () => ({ error: null }),
    remove: async (paths) => { removed.push(...paths); return { error: null }; },
    createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/signed' }, error: null }),
  };
  const query = {
    update: () => query, eq: () => query, select: () => query,
    maybeSingle: async () => profileResult,
  };
  return { client: { storage: { from: () => bucket }, from: () => query }, removed };
};

test('a denied profile update keeps the old avatar and rolls back only the new upload', async () => {
  const { client, removed } = avatarClient({ data: null, error: null });
  await assert.rejects(storeEmployeeAvatar({
    client, employeeId: 'employee', image: new Blob(['image']),
    previousPath: 'employee/old.jpg', version: 123,
  }), /could not be linked/);
  assert.deepEqual(removed, ['employee/avatar-123.jpg']);
});

test('a confirmed profile update removes only the superseded avatar', async () => {
  const { client, removed } = avatarClient({ data: { avatar_path: 'employee/avatar-123.jpg' }, error: null });
  const result = await storeEmployeeAvatar({
    client, employeeId: 'employee', image: new Blob(['image']),
    previousPath: 'employee/old.jpg', version: 123,
  });
  assert.equal(result.path, 'employee/avatar-123.jpg');
  assert.deepEqual(removed, ['employee/old.jpg']);
});

test('avatar helpers distinguish embedded data from cacheable URLs', () => {
  assert.equal(isEmbeddedAvatar('data:image/jpeg;base64,aGk='), true);
  assert.equal(isEmbeddedAvatar('https://example.test/avatar.jpg'), false);
  assert.equal(cacheableAvatarUrl('https://example.test/avatar.jpg'), 'https://example.test/avatar.jpg');
  assert.equal(cacheableAvatarUrl('data:image/jpeg;base64,aGk='), null);
  assert.equal(cacheableAvatarUrl('http://example.test/avatar.jpg'), null);
});

test('avatar paths are versioned inside the employee-owned folder', () => {
  assert.equal(
    avatarPathForEmployee('00000000-0000-0000-0000-000000000001', 1234),
    '00000000-0000-0000-0000-000000000001/avatar-1234.jpg',
  );
});

test('legacy base64 avatars can be converted without persisting the data URL again', async () => {
  const blob = dataUrlToBlob('data:image/jpeg;base64,aGk=');
  assert.equal(blob.type, 'image/jpeg');
  assert.equal(await blob.text(), 'hi');
});

test('the live board uses one visibility-aware low-frequency status request', () => {
  const board = read('../components/LiveStatusBoard.jsx');
  const layout = read('../components/Layout.jsx');

  assert.match(board, /supabase\.rpc\('live_work_status'\)/);
  assert.doesNotMatch(board, /live_attendance_work_modes/);
  assert.match(board, /document\.visibilityState === 'visible'/);
  assert.match(board, /60000/);
  assert.match(layout, /active=\{wideScreen \|\| liveStatusOpen\}/);
});

test('avatar persistence uses private Storage paths and clears database image bytes', () => {
  const avatarSource = read('./avatars.js');
  const topBar = read('../components/TopBar.jsx');
  const migration = read('../../supabase/migrations/20260828000100_avatar_egress_optimisation.sql');

  assert.match(avatarSource, /\.from\(AVATAR_BUCKET\)[\s\S]*\.upload\(/);
  assert.match(avatarSource, /update\(\{ avatar_path: path, avatar_url: null \}\)/);
  assert.doesNotMatch(topBar, /toDataURL/);
  assert.match(topBar, /migrateEmbeddedEmployeeAvatar/);
  assert.match(migration, /'employee-avatars'[\s\S]*false[\s\S]*524288/);
  assert.match(migration, /CREATE POLICY employee_avatars_read/);
  assert.match(migration, /CREATE POLICY employee_avatars_insert_own/);
  assert.match(migration, /CREATE POLICY employee_avatars_delete_own/);
  assert.match(migration, /WHEN employee\.avatar_url ~\* '\^https:\/\/'/);
  assert.match(migration, /NEW\.avatar_url IS NOT DISTINCT FROM OLD\.avatar_url/);
  assert.match(migration, /OR NEW\.avatar_url IS NULL/);
});
