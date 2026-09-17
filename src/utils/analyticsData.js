import { appDateKey, appDayRange } from './timezone.js';
import { splitAnalyticsRange, aggregateAnalyticsEntries } from './analyticsPeriods.js';

const cache = new Map();
const PAGE_SIZE = 500;
const missingRpc = (error) => error?.code === 'PGRST202' || error?.code === '42883';
export async function readAllPages(query, isCurrent = () => true) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    if (!isCurrent()) throw new Error('Reporting request cancelled');
    const { data, error } = await query().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
export async function earliestAnalyticsDate(client, today) {
  const results = await Promise.all([
    client.from('work_entries').select('started_at').is('voided_at', null).order('started_at').limit(1),
    client.from('organisation_downtime_events').select('started_at').is('cancelled_at', null).order('started_at').limit(1),
  ]);
  for (const result of results) if (result.error) throw result.error;
  return results.flatMap(({ data }) => data?.map((row) => appDateKey(row.started_at)) || []).filter((date) => date <= today).sort()[0] || today;
}
export async function loadAnalytics(client, range, scope, userId, { details = false, isCurrent = () => true, refresh = false } = {}) {
  const key = JSON.stringify([userId, scope, range, details]);
  const cached = cache.get(key);
  if (!refresh && cached && Date.now() - cached.at < 30000) return cached.value;
  const args = { requested_start_at: appDayRange(range.start, range.end).start, requested_end_at: appDayRange(range.start, range.end).end, requested_scope: scope };
  let rows;
  if (details) {
    try {
      rows = await readAllPages(() => client.rpc('analytics_entries', args).order('work_entry_id'), isCurrent);
    } catch (error) { if (!missingRpc(error)) throw error; }
  } else {
    const result = await client.rpc('analytics_summary', args);
    if (result.error && !missingRpc(result.error)) throw result.error;
    if (!result.error) rows = result.data || [];
  }
  // Compatibility until the Analytics migration is deployed. Page every chunk;
  // never silently accept PostgREST's default row cap as a complete result.
  if (!rows) {
    const earliest = await earliestAnalyticsDate(client, range.end);
    rows = [];
    for (const chunk of splitAnalyticsRange(range.start > earliest ? range.start : earliest, range.end)) {
      const window = appDayRange(chunk.start, chunk.end);
      const batch = await readAllPages(() => client.rpc('scoped_timesheet_entries', {
        requested_start_at: window.start, requested_end_at: window.end,
        requested_scope: scope, requested_employee_id: null,
      }).order('work_entry_id'), isCurrent);
      rows = details ? [...rows, ...batch] : aggregateAnalyticsEntries([...rows, ...batch]);
    }
  }
  const events = new Map();
  if (!details) {
    // Downtime is clipped by each non-overlapping window, then merged by ID.
    for (const chunk of splitAnalyticsRange(range.start, range.end, 366)) {
      const window = appDayRange(chunk.start, chunk.end);
      const batch = await readAllPages(() => client.rpc('organisation_downtime_for_period', {
        requested_start_at: window.start, requested_end_at: window.end,
      }).order('downtime_event_id'), isCurrent);
      for (const event of batch) {
        const previous = events.get(event.downtime_event_id);
        events.set(event.downtime_event_id, { ...event, recorded_seconds: Number(event.recorded_seconds) + Number(previous?.recorded_seconds || 0) });
      }
    }
  }
  if (!isCurrent()) throw new Error('Reporting request cancelled');
  const value = { rows, downtime: [...events.values()] };
  cache.set(key, { at: Date.now(), value });
  while (cache.size > 6) cache.delete(cache.keys().next().value);
  return value;
}
