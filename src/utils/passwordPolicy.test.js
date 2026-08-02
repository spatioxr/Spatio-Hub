import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStrongPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIREMENT_MESSAGE,
} from './passwordPolicy.js';

test('accepts any replacement password with at least eight characters', () => {
  assert.equal(isStrongPassword('password'), true);
  assert.equal(isStrongPassword('12345678'), true);
});

test('rejects replacement passwords shorter than eight characters', () => {
  assert.equal(isStrongPassword('1234567'), false);
  assert.equal(isStrongPassword(''), false);
});

test('exports matching password guidance', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8);
  assert.equal(PASSWORD_REQUIREMENT_MESSAGE, 'Use at least 8 characters.');
});
