import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldBlockForAuthEvent } from './authEvents.js';

test('initial auth restoration blocks until the profile is ready', () => {
  assert.equal(shouldBlockForAuthEvent({
    event: 'INITIAL_SESSION',
    currentAuthUserId: null,
    nextAuthUserId: 'auth-user-1',
  }), true);
});

test('background auth events for the current user keep the page mounted', () => {
  ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].forEach((event) => {
    assert.equal(shouldBlockForAuthEvent({
      event,
      currentAuthUserId: 'auth-user-1',
      nextAuthUserId: 'auth-user-1',
    }), false, event);
  });
});

test('a genuine authenticated account change remains blocking', () => {
  assert.equal(shouldBlockForAuthEvent({
    event: 'SIGNED_IN',
    currentAuthUserId: 'auth-user-1',
    nextAuthUserId: 'auth-user-2',
  }), true);
});
