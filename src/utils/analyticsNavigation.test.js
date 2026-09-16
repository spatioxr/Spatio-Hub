import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changeAnalyticsFilter,
  emptyAnalyticsFilters,
  readAnalyticsView,
  retainAnalyticsOption,
  validAnalyticsRange,
  writeAnalyticsView,
} from './analyticsNavigation.js';

const today = '2026-09-16';
const selected = { project: 'p1', activity: 'a1', department: 'Design', employee: 'e1' };

test('chart selection and deselection preserve every other filter', () => {
  for (const key of Object.keys(selected)) {
    const deselected = changeAnalyticsFilter(selected, key, selected[key], true);
    assert.deepEqual(deselected, { ...selected, [key]: 'all' });
    assert.deepEqual(changeAnalyticsFilter(deselected, key, selected[key], true), selected);
    assert.deepEqual(changeAnalyticsFilter(selected, key, 'new', true), changeAnalyticsFilter(selected, key, 'new'));
  }
  assert.deepEqual(selected, { project: 'p1', activity: 'a1', department: 'Design', employee: 'e1' });
});

test('URL round-trip restores dates and combined filters after navigation or reload', () => {
  const view = { range: { start: '2026-08-01', end: '2026-08-31' }, filters: selected };
  const search = writeAnalyticsView('other=keep', view);
  assert.deepEqual(readAnalyticsView(search.toString(), today), view);
  assert.equal(search.get('other'), 'keep');
});

test('changing or reapplying the reporting period retains filters', () => {
  const before = { range: { start: '2026-09-10', end: today }, filters: selected };
  const originalSearch = writeAnalyticsView('', before);
  const next = { ...before, range: { start: '2026-08-01', end: '2026-08-31' } };
  assert.deepEqual(readAnalyticsView(writeAnalyticsView(originalSearch, next), today), next);
  assert.equal(writeAnalyticsView(originalSearch, before).toString(), originalSearch.toString());
});

test('clearing filters retains the reporting period and removes stale URL selections', () => {
  const view = { range: { start: '2026-09-01', end: today }, filters: emptyAnalyticsFilters() };
  const search = writeAnalyticsView('project=p1&activity=a1&department=Design&employee=e1', view);
  assert.equal(search.get('project'), null);
  assert.equal(search.get('activity'), null);
  assert.deepEqual(readAnalyticsView(search, today), view);
});

test('restored ranges respect real dates, ordering, future dates and the 31-day server limit', () => {
  for (const [start, end] of [
    ['invalid', today], ['2026-02-30', '2026-03-02'],
    ['2026-09-16', '2026-09-01'], ['2026-08-01', '2026-09-01'],
    ['2026-09-01', '2026-09-17'], ['', ''],
  ]) {
    assert.equal(validAnalyticsRange(start, end, today), false);
    const restored = readAnalyticsView(new URLSearchParams({ start, end, project: 'p1' }), today);
    assert.deepEqual(restored.range, { start: '2026-09-10', end: today });
    assert.equal(restored.filters.project, 'p1');
  }
  assert.equal(validAnalyticsRange('2026-08-01', '2026-08-31', today), true);
  assert.equal(validAnalyticsRange(today, today, today), true);
});

test('a retained filter remains visible and removable when the new period has no matching work', () => {
  const options = [{ value: 'p2', label: 'Project two' }];
  assert.deepEqual(retainAnalyticsOption(options, 'p1', 'Project one'), [
    ...options, { value: 'p1', label: 'Project one' },
  ]);
  assert.deepEqual(retainAnalyticsOption([], 'p1'), [
    { value: 'p1', label: 'Selected (no entries in this period)' },
  ]);
  assert.equal(retainAnalyticsOption(options, 'p2'), options);
  assert.equal(retainAnalyticsOption(options, 'all'), options);
});
