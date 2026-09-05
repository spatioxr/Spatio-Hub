import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('first start keeps Office implicit and presents WFH as a secondary action', () => {
  const modal = read('../components/WorkStartModal.jsx');

  assert.match(modal, /Mark today as WFH/);
  assert.match(modal, /isWfh \? 'wfh' : 'office'/);
  assert.match(modal, /isReopen \? null/);
  assert.doesNotMatch(modal, /Where are you working today/);
  assert.doesNotMatch(modal, /Office[\s\S]*Work from home[\s\S]*aria-pressed/);
});

test('controlled workday start sends the daily mode only when supplied', () => {
  const context = read('../context/WorkSessionContext.jsx');

  assert.match(context, /if \(workMode\) startArguments\.declared_work_mode = workMode/);
  assert.match(context, /supabase\.rpc\('start_work_day', startArguments\)/);
});

test('manual add and correction require and audit a daily work mode', () => {
  const timesheets = read('../pages/Timesheets.jsx');

  assert.match(timesheets, /Work mode for this day/);
  assert.match(timesheets, /entry_work_mode: manualForm\.workMode/);
  assert.match(timesheets, /key: 'work-mode'/);
  assert.match(timesheets, /scoped_attendance_work_modes/);
});

test('live and attendance views expose WFH without making Office noisy', () => {
  const liveStatus = read('../components/LiveStatusBoard.jsx');
  const attendance = read('../pages/Attendance.jsx');

  assert.match(liveStatus, /row\.work_mode === 'wfh'/);
  assert.doesNotMatch(liveStatus, /live_attendance_work_modes/);
  assert.match(attendance, /Work from home/);
  assert.match(attendance, /Not recorded/);
});

test('database migration stores one validated mode and keeps writes controlled', () => {
  const migration = read('../../supabase/migrations/20260815000300_daily_work_mode.sql');

  assert.match(migration, /ADD COLUMN IF NOT EXISTS work_mode TEXT/);
  assert.match(migration, /work_mode IN \('office', 'wfh'\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.start_work_day\([\s\S]*declared_work_mode TEXT/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.correct_manual_time_entry\([\s\S]*entry_work_mode TEXT/);
  assert.match(migration, /existing_work_mode IS NOT DISTINCT FROM normalised_work_mode/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.apply_attendance_work_mode[\s\S]*authenticated/);
});
