import test from 'node:test';
import assert from 'node:assert/strict';
import { moveManualEntryDate, manualEntryPreview } from './manualEntry.js';
const form = { startedAt: '2026-09-17T09:00', endedAt: '2026-09-17T12:00', breaks: [], reason: 'Forgot timer' };
test('manual duration subtracts breaks and permits adjacent entries', () => {
  const entry = { employee_id: 'a', work_entry_id: '1', started_at: '2026-09-17T06:30:00Z', ended_at: '2026-09-17T07:30:00Z' };
  assert.deepEqual(manualEntryPreview({ ...form, breaks: [{ startedAt: '2026-09-17T10:00', endedAt: '2026-09-17T10:30' }] }, [entry], 'a'), { error: '', seconds: 9000 });
});
test('manual overlap detects open sessions, excludes self corrections and other people', () => {
  const entry = { employee_id: 'a', work_entry_id: '1', started_at: '2026-09-17T04:00:00Z', ended_at: null };
  assert.match(manualEntryPreview(form, [entry], 'a').error, /overlaps/);
  assert.equal(manualEntryPreview(form, [entry], 'a', '1').error, '');
  assert.equal(manualEntryPreview(form, [entry], 'b').error, '');
});
test('invalid ranges and overlapping breaks do not show misleading duration', () => {
  assert.equal(manualEntryPreview({ ...form, startedAt: '2026-09-17T' }).seconds, null);
  assert.match(manualEntryPreview({ ...form, endedAt: form.startedAt }).error, /after From/);
  const breaks = [{ startedAt: '2026-09-17T10:00', endedAt: '2026-09-17T11:00' }, { startedAt: '2026-09-17T10:30', endedAt: '2026-09-17T11:30' }];
  assert.match(manualEntryPreview({ ...form, breaks }).error, /not overlap/);
});
test('changing entry date preserves overnight span and break offsets across years', () => {
  const overnight = { ...form, startedAt: '2026-12-31T22:00', endedAt: '2027-01-01T02:00', breaks: [{ startedAt: '2027-01-01T00:00', endedAt: '2027-01-01T00:30' }] };
  const moved = moveManualEntryDate(overnight, '2027-01-31');
  assert.equal(moved.endedAt, '2027-02-01T02:00');
  assert.equal(moved.breaks[0].startedAt, '2027-02-01T00:00');
  assert.equal(manualEntryPreview(moved).seconds, 12600);
  assert.equal(moved.reason, form.reason);
  assert.equal(moveManualEntryDate(form, ''), form);
});
