import { appDateDistance } from './timezone.js';

export const validObserverRange = (start, end) =>
  /^\d{4}-\d{2}-\d{2}$/.test(start) &&
  /^\d{4}-\d{2}-\d{2}$/.test(end) &&
  appDateDistance(start, end) >= 0 &&
  appDateDistance(start, end) <= 30;

export const summarizeObserverWork = (entries = []) => {
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.context_type}:${entry.project_id || entry.context_name}`;
    const group = groups.get(key) || {
      key,
      name: entry.context_name,
      seconds: 0,
      unresolved: 0,
    };
    if (entry.stale) group.unresolved += 1;
    else group.seconds += Math.max(0, Number(entry.worked_seconds) || 0);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name),
  );
};

export const observerAttendanceLabel = (row, holidays = []) => {
  if (row.check_in)
    return row.approved_leave
      ? 'Recorded work · approved leave'
      : 'Recorded work';
  if (row.approved_leave) return 'Approved leave';
  if (holidays.some((holiday) => holiday.date === row.date)) return 'Holiday';
  if ([0, 6].includes(new Date(`${row.date}T12:00:00Z`).getUTCDay()))
    return 'Weekend';
  return row.status === 'Absent' ? 'Recorded absent' : 'No record';
};
