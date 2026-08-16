import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../pages/Timesheets.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../supabase/migrations/20260816000600_timesheet_manual_entry_ux.sql', import.meta.url),
  'utf8',
);

test('Timesheets keeps Month separate from the manual Add Time workspace', () => {
  assert.match(page, />\s*Week\s*</);
  assert.match(page, />\s*Month\s*</);
  assert.match(page, /Add time/);
  assert.doesNotMatch(page, /Day Builder|Build and review time/i);
  assert.match(page, /viewMode === 'week'/);
  assert.match(page, /timesheet-month-calendar/);
});

test('manual entry supports continuous save actions and event-order cues', () => {
  assert.match(page, /Save &amp; add another/);
  assert.match(page, /Save & next day/);
  assert.match(page, /Start work/);
  assert.match(page, /Start break/);
  assert.match(page, /Resume work/);
  assert.match(page, /End work/);
  assert.doesNotMatch(page, /Change project/);
  assert.match(page, /Correct entry/);
});

test('accidental entries are voided through a controlled audited function', () => {
  assert.match(page, /void_manual_time_entry/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.void_manual_time_entry/);
  assert.match(migration, /INSERT INTO public\.work_entry_audit/);
  assert.match(migration, /WHERE entry\.voided_at IS NULL/);
  assert.match(migration, /Voided work entries are immutable/);
});

test('month and manual-entry layouts include narrow-screen safeguards', () => {
  assert.match(styles, /\.timesheet-month-calendar/);
  assert.match(styles, /\.timesheet-entry-sequence/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.timesheet-month-people/);
});
