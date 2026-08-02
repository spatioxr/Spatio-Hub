import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStrongPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENT_MESSAGE,
} from './passwordPolicy.js';

test('accepts a password that satisfies every temporary-password replacement rule', () => {
  assert.equal(isStrongPassword('Spatio!Pilot9'), true);
});

test('rejects passwords missing length or a required character class', () => {
  assert.equal(isStrongPassword('Short!9A'), false);
  assert.equal(isStrongPassword('SPATIO!PILOT9'), false);
  assert.equal(isStrongPassword('spatio!pilot9'), false);
  assert.equal(isStrongPassword('Spatio!PilotX'), false);
  assert.equal(isStrongPassword('Spatio9PilotX'), false);
});

test('exports matching password guidance', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 12);
  assert.match(PASSWORD_REQUIREMENT_MESSAGE, /uppercase, lowercase, number, and symbol/);
});
