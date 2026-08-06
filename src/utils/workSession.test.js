import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getElapsedSeconds,
  getWorkStatus,
  isTaskDescriptionValidForMode,
} from './workSession.js';

test('timer status follows the out, working, break, working, out lifecycle', () => {
  const session = { id: 'session-1' };

  assert.equal(getWorkStatus(), 'out');
  assert.equal(getWorkStatus({ session }), 'working');
  assert.equal(getWorkStatus({ session, breakEntry: { id: 'break-1' } }), 'break');
  assert.equal(getWorkStatus({ session, breakEntry: null }), 'working');
  assert.equal(getWorkStatus({ session: null, breakEntry: null }), 'out');
});

test('active elapsed time advances from the server-calculated worked total', () => {
  const syncedAt = Date.UTC(2026, 6, 30, 9, 0, 0);
  const now = syncedAt + 15_400;

  assert.equal(getElapsedSeconds({
    session: { id: 'session-1' },
    breakEntry: null,
    workedSeconds: 120,
    syncedAt,
  }, now), 135);
});

test('elapsed time freezes on break and never becomes negative', () => {
  const syncedAt = Date.UTC(2026, 6, 30, 9, 0, 0);

  assert.equal(getElapsedSeconds({
    session: { id: 'session-1' },
    breakEntry: { id: 'break-1' },
    workedSeconds: 120,
    syncedAt,
  }, syncedAt + 60_000), 120);

  assert.equal(getElapsedSeconds({
    session: { id: 'session-1' },
    workedSeconds: -30,
    syncedAt,
  }, syncedAt - 10_000), 0);
});

test('task descriptions are only mandatory when switching work context', () => {
  assert.equal(isTaskDescriptionValidForMode('', 'start'), true);
  assert.equal(isTaskDescriptionValidForMode(undefined, 'start'), true);
  assert.equal(isTaskDescriptionValidForMode('   ', 'switch'), false);
  assert.equal(isTaskDescriptionValidForMode('Describe the new task', 'switch'), true);
});
