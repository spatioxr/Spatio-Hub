import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRows } from './sorting.js';

test('sorts numeric hours rather than formatted text, without mutating source', () => {
  const rows = [{ n: 100 }, { n: 9.5 }, { n: 40 }];
  assert.deepEqual(sortRows(rows, (r) => r.n).map((r) => r.n), [9.5, 40, 100]);
  assert.deepEqual(sortRows(rows, (r) => r.n, 'desc').map((r) => r.n), [100, 40, 9.5]);
  assert.equal(rows[0].n, 100);
});
test('natural case-insensitive names/codes, missing last, stable ties', () => {
  const rows = [{ id: 1, n: 'XR10' }, { id: 2, n: null }, { id: 3, n: 'xr2' }, { id: 4, n: 'XR2' }];
  assert.deepEqual(sortRows(rows, (r) => r.n).map((r) => r.id), [3, 4, 1, 2]);
  assert.deepEqual(sortRows(rows, (r) => r.n, 'desc').map((r) => r.id), [1, 3, 4, 2]);
});
test('dates sort chronologically across month and year boundaries', () => {
  const rows = ['2026-09-01', '2025-12-31', '2026-01-02', null];
  assert.deepEqual(sortRows(rows, (r) => r), ['2025-12-31', '2026-01-02', '2026-09-01', null]);
});
test('zero is a valid number, unresolved values remain last in either direction', () => {
  const rows = [null, 0, 20, NaN, '—'];
  assert.deepEqual(sortRows(rows, (r) => r, 'desc'), [20, 0, null, NaN, '—']);
});
