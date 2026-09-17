import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkloadCache } from './workloadCache.js';

test('workload cache expires at 30 seconds and separates periods', () => {
  let time = 0;
  const cache = createWorkloadCache({ now: () => time });
  cache.set('session-a', '2026-09', ['september']);
  assert.equal(cache.get('session-a', '2026-10'), null);
  time = 29999;
  assert.deepEqual(cache.get('session-a', '2026-09'), ['september']);
  time = 30000;
  assert.equal(cache.get('session-a', '2026-09'), null);
});

test('session or permission changes discard previous cached results', () => {
  const cache = createWorkloadCache();
  cache.set('admin-session', 'month', ['private']);
  assert.equal(cache.get('manager-session', 'month'), null);
  assert.equal(cache.get('admin-session', 'month'), null);
});

test('forced refresh invalidates all periods and cache retains at most six', () => {
  const cache = createWorkloadCache();
  for (let i = 0; i < 7; i++) cache.set('a', String(i), [i]);
  assert.equal(cache.get('a', '0'), null);
  assert.deepEqual(cache.get('a', '6'), [6]);
  cache.clear();
  assert.equal(cache.get('a', '6'), null);
});
