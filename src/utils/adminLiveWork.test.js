import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('only admins receive the delegated live-work capability', () => {
  const rbac = read('./rbac.js');
  assert.match(rbac, /MANAGE_LIVE_WORK: 'manage_live_work'/);
  assert.match(rbac, /\[ROLES\.ADMIN\][\s\S]*PERMISSIONS\.MANAGE_LIVE_WORK/);
  assert.doesNotMatch(rbac, /\[ROLES\.MANAGER\][\s\S]*PERMISSIONS\.MANAGE_LIVE_WORK[\s\S]*\[ROLES\.ADMIN\]/);
});

test('clicking a live-status person opens contextual admin controls', () => {
  const board = read('../components/LiveStatusBoard.jsx');
  const controls = read('../components/AdminWorkControlModal.jsx');
  assert.match(board, /setSelectedEmployee\(row\)/);
  assert.match(board, /Manage live work for/);
  [
    'admin_employee_work_state',
    'admin_start_work_day',
    'admin_switch_work_session',
    'admin_start_work_break',
    'admin_resume_work_session',
    'admin_end_work_day',
  ].forEach((functionName) => assert.match(controls, new RegExp(`'${functionName}'`)));
});

test('delegated mutations are server-authorised and audit every action', () => {
  const migration = read('../../supabase/migrations/20260816000100_admin_live_work_actions.sql');
  assert.match(migration, /public\.current_employee_role\(\) IN \('admin', 'superadmin'\)/);
  assert.match(migration, /ALTER TABLE public\.admin_work_action_audit ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.admin_work_action_audit/);
  assert.match(migration, /admin_work_action_audit_prevent_mutation/);
  ['start', 'reopen', 'switch', 'break', 'resume', 'end_day']
    .forEach((action) => assert.match(migration, new RegExp(`'${action}'`)));
});
