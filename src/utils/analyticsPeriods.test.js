import assert from 'node:assert/strict';
import test from 'node:test';
import { periodRange, monthShift, splitAnalyticsRange, aggregateAnalyticsEntries } from './analyticsPeriods.js';
import { readAllPages } from './analyticsData.js';
import { readAnalyticsView, writeAnalyticsView, emptyAnalyticsFilters } from './analyticsNavigation.js';

test('calendar weeks start Monday and current periods end today', () => {
  assert.deepEqual(periodRange('week', '2026-09-17', '2026-09-17'), { start: '2026-09-14', end: '2026-09-17' });
  assert.deepEqual(periodRange('week', '2026-09-13', '2026-09-17'), { start: '2026-09-07', end: '2026-09-13' });
  assert.deepEqual(periodRange('month', '2024-02-22', '2026-09-17'), { start: '2024-02-01', end: '2024-02-29' });
  assert.equal(monthShift('2026-12-31', 1), '2027-01-01');
});
test('long ranges split without gaps or overlapping boundary days', () => {
  assert.deepEqual(splitAnalyticsRange('2024-01-01', '2024-03-03'), [
    { start: '2024-01-01', end: '2024-01-31' },
    { start: '2024-02-01', end: '2024-03-02' },
    { start: '2024-03-03', end: '2024-03-03' },
  ]);
});
test('incremental summaries preserve session counts and totals across chunks', () => {
  const row = { employee_id: 'e', context_type: 'project', context_id: 'p', worked_seconds: 3600, break_seconds: 600 };
  const first = aggregateAnalyticsEntries([row, row]);
  const merged = aggregateAnalyticsEntries([...first, row]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].session_count, 3);
  assert.equal(merged[0].worked_seconds, 10800);
  assert.equal(merged[0].break_seconds, 1800);
});
test('pagination loads beyond server page size and surfaces errors', async () => {
  const values = Array.from({ length: 1101 }, (_, id) => ({ id }));
  assert.deepEqual(await readAllPages(() => ({ range: async (a, b) => ({ data: values.slice(a, b + 1) }) })), values);
  await assert.rejects(readAllPages(() => ({ range: async () => ({ error: new Error('denied') }) })), /denied/);
  await assert.rejects(readAllPages(() => ({}), () => false), /cancelled/);
});
test('period mode and multi-year dates survive URL round trips with filters', () => {
  const view = { mode: 'custom', range: { start: '2020-01-01', end: '2026-09-17' }, filters: { ...emptyAnalyticsFilters(), employee: 'e' } };
  assert.deepEqual(readAnalyticsView(writeAnalyticsView('', view), '2026-09-17'), view);
});

test('compatibility loader aggregates chunked work and merges clipped downtime exactly once', async () => {
  const { loadAnalytics } = await import('./analyticsData.js');
  const rows = Array.from({ length: 1101 }, (_, id) => ({ work_entry_id: String(id), employee_id: 'e', context_id: 'p', context_type: 'project', worked_seconds: 60, break_seconds: 10 }));
  const client = {
    from: () => ({ select: () => ({ is: () => ({ order: () => ({ limit: async () => ({ data: [{ started_at: '2025-01-01T00:00:00+05:30' }] }) }) }) }) }),
    rpc: (name, args) => {
      if (name === 'analytics_summary') return Promise.resolve({ error: { code: 'PGRST202' } });
      return { order: () => ({ range: async (start, end) => {
        if (name === 'analytics_entries') return { error: { code: 'PGRST202' } };
        const data = name === 'organisation_downtime_for_period' ? [{ downtime_event_id: 'd', recorded_seconds: 120 }]
          : args.requested_start_at === '2024-12-31T18:30:00.000Z' ? rows : [];
        return { data: data.slice(start, end + 1) };
      } }) };
    },
  };
  const range = { start: '2025-01-01', end: '2026-01-02' };
  const summary = await loadAnalytics(client, range, 'organisation', 'test-summary');
  assert.equal(summary.rows[0].session_count, 1101);
  assert.equal(summary.rows[0].worked_seconds, 66060);
  assert.equal(summary.downtime.length, 1);
  assert.equal(summary.downtime[0].recorded_seconds, 240);
  const details = await loadAnalytics(client, range, 'organisation', 'test-details', { details: true });
  assert.equal(details.rows.length, 1101);
});

test('analytics SQL preserves the current per-entry authorization boundary', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../../supabase/migrations/20260917000100_analytics_reporting.sql', import.meta.url), 'utf8');
  assert.match(sql, /AND public\.can_access_work_entry\(entry\.id\)/);
  assert.match(sql, /requested_scope IS NULL OR requested_scope NOT IN \('managed', 'organisation'\)/);
  assert.match(sql, /actor_employee_id IS NULL/);
  assert.match(sql, /actor_role NOT IN \('admin', 'superadmin'\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.analytics_entries.*FROM PUBLIC, anon/);
});
