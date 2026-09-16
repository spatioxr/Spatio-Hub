import { appDateKey, APP_TIME_ZONE } from './timezone.js';
import { downtimeCategoryLabel, downtimeStatusLabel } from './downtime.js';

export const ANALYTICS_EXPORT_TYPES = Object.freeze([
  { value: 'entries', label: 'Work entries' },
  { value: 'daily', label: 'Daily employee summary' },
  { value: 'downtime', label: 'Organisation downtime' },
]);

const neutralizeFormula = (value) => {
  const text = String(value ?? '');
  // Spreadsheet applications can ignore leading whitespace before a formula.
  return /^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
};
const csvCell = (value) => `"${neutralizeFormula(value).replace(/"/g, '""')}"`;
const csvTable = (headers, rows) => `\uFEFF${[headers, ...rows]
  .map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
const seconds = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
const hours = (value) => (seconds(value) / 3600).toFixed(2);
const person = (entry) => [entry.employee_code, entry.employee_name, entry.employee_department || 'Not assigned'];

const timestampFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const timestamp = (value) => {
  if (!value) return '';
  const parts = Object.fromEntries(timestampFormatter.formatToParts(new Date(value))
    .filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

export const workDistributionCsvFilename = ({ start, end }, type = 'entries') => {
  const names = { entries: 'work-entries', daily: 'daily-employee-summary', downtime: 'organisation-downtime' };
  if (!names[type]) throw new Error('Unknown analytics export type.');
  return `spatio-${names[type]}_${start}_to_${end}.csv`;
};

export const buildWorkDistributionCsv = (entries) => csvTable([
  'Work date (IST)', 'Employee code', 'Employee', 'Department', 'Work type',
  'Project / activity', 'Task description', 'Start (IST)', 'End (IST)', 'Status',
  'Break hours', 'Worked hours',
], entries.map((entry) => [
  appDateKey(entry.started_at), ...person(entry),
  entry.context_type === 'project' ? 'Project' : 'Activity', entry.context_label,
  entry.task_description || '', timestamp(entry.started_at), timestamp(entry.ended_at),
  entry.ended_at ? 'Completed' : 'In progress', hours(entry.break_seconds), hours(entry.worked_seconds),
]));

// Match Analytics and Timesheets: credit the whole session to its IST start date.
// Aggregate server-supplied seconds before rounding, preserving the loaded snapshot.
export const buildDailyEmployeeCsv = (entries) => {
  const groups = new Map();
  for (const entry of entries) {
    const date = appDateKey(entry.started_at);
    const key = JSON.stringify([date, entry.employee_id]);
    const group = groups.get(key) || { date, entry, sessions: 0, breaks: 0, worked: 0, open: false };
    group.sessions += 1;
    group.breaks += seconds(entry.break_seconds);
    group.worked += seconds(entry.worked_seconds);
    group.open ||= !entry.ended_at;
    groups.set(key, group);
  }
  const rows = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date)
    || (a.entry.employee_name || '').localeCompare(b.entry.employee_name || '')
    || (a.entry.employee_id || '').localeCompare(b.entry.employee_id || ''));
  return csvTable([
    'Work date (IST)', 'Employee code', 'Employee', 'Department', 'Session count',
    'Break hours', 'Worked hours', 'Status',
  ], rows.map((group) => [group.date, ...person(group.entry), group.sessions,
    hours(group.breaks), hours(group.worked), group.open ? 'In progress' : 'Completed']));
};

export const buildOrganisationDowntimeCsv = (events) => csvTable([
  'Event', 'Category', 'Status', 'Start (IST)', 'End (IST)', 'Recorded hours', 'Notes',
], events.map((event) => [event.title, downtimeCategoryLabel(event.category),
  downtimeStatusLabel(event.event_status), timestamp(event.started_at), timestamp(event.ended_at),
  hours(event.recorded_seconds), event.notes || '',
]));
