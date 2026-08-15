import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('People shows unavailable phone numbers without inventing a fallback', () => {
  const people = read('../pages/People.jsx');

  assert.match(people, /Phone not available/);
  assert.match(people, /No phone number is available/);
  assert.doesNotMatch(people, /98765 43210/);
});

test('private employee details use a separate role-controlled database boundary', () => {
  const people = read('../pages/People.jsx');
  const migration = read('../../supabase/migrations/20260816000300_employee_private_details.sql');
  const narrowingMigration = read('../../supabase/migrations/20260816000400_narrow_employee_private_details.sql');

  assert.match(people, /\.from\('employee_private_details'\)/);
  assert.match(people, /supabase\.rpc\(\s*'upsert_employee_private_details'/s);
  assert.match(migration, /USING \(public\.can_manage_people\(\)\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.employee_private_details FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(`${migration}\n${narrowingMigration}`, /\bpan_number\b/i);
  assert.match(narrowingMigration, /DROP COLUMN aadhaar_number/);
  assert.match(narrowingMigration, /DROP COLUMN last_working_date/);
});
