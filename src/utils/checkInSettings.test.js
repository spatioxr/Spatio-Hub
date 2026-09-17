import assert from 'node:assert/strict';
import test from 'node:test';
import { checkInRequirements, hasCheckInException, checkInSettingsChanged } from './checkInSettings.js';
test('missing settings require both reports and explicit exemptions stay optional', () => {
  assert.deepEqual(checkInRequirements(), { bos_required: true, eod_required: true });
  assert.equal(hasCheckInException(), false);
  for (const value of [{ bos_required: false }, { eod_required: false }, { bos_required: false, eod_required: false }]) assert.equal(hasCheckInException(value), true);
});
test('editing and discarding a draft never mutates saved requirements', () => {
  const saved = { employee_id: 'a', bos_required: true, eod_required: false };
  const draft = checkInRequirements(saved);
  assert.equal(checkInSettingsChanged(saved, draft), false);
  draft.bos_required = false;
  assert.equal(checkInSettingsChanged(saved, draft), true);
  assert.equal(saved.bos_required, true);
  assert.deepEqual(checkInRequirements(saved), { bos_required: true, eod_required: false });
});
