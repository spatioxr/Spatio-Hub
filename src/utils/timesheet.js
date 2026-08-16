import { addAppDays, appDateKey, toAppDateTimeInput } from './timezone.js';

export const monthBounds = (value = new Date()) => {
  const dateKey = appDateKey(value);
  const [year, month] = dateKey.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(year, month, 0, 12));
  const end = endDate.toISOString().slice(0, 10);
  return { year, month, start, end, days: endDate.getUTCDate() };
};

export const dateKeysInRange = (startDate, endDate) => {
  const keys = [];
  let current = startDate;
  while (current <= endDate) {
    keys.push(current);
    current = addAppDays(current, 1);
  }
  return keys;
};

export const summarizeTimesheetDays = (entries, dateKeys) => {
  const summaries = Object.fromEntries(dateKeys.map((date) => [date, {
    workedSeconds: 0,
    breakSeconds: 0,
    sessionCount: 0,
    hasOpenSession: false,
  }]));

  entries.forEach((entry) => {
    const date = appDateKey(entry.started_at);
    if (!summaries[date]) return;
    summaries[date].workedSeconds += Number(entry.worked_seconds || 0);
    summaries[date].breakSeconds += Number(entry.break_seconds || 0);
    summaries[date].sessionCount += 1;
    summaries[date].hasOpenSession ||= !entry.ended_at;
  });

  return summaries;
};

export const summarizeEmployeesForMonth = (entries, members) => {
  const byEmployee = new Map(members.map((member) => [member.employee_id, {
    ...member,
    workedSeconds: 0,
    breakSeconds: 0,
    sessionCount: 0,
    activeDates: new Set(),
    hasOpenSession: false,
  }]));

  entries.forEach((entry) => {
    const summary = byEmployee.get(entry.employee_id);
    if (!summary) return;
    summary.workedSeconds += Number(entry.worked_seconds || 0);
    summary.breakSeconds += Number(entry.break_seconds || 0);
    summary.sessionCount += 1;
    summary.activeDates.add(appDateKey(entry.started_at));
    summary.hasOpenSession ||= !entry.ended_at;
  });

  return [...byEmployee.values()]
    .map(({ activeDates, ...summary }) => ({
      ...summary,
      activeDays: activeDates.size,
    }))
    .sort((left, right) => (
      right.workedSeconds - left.workedSeconds
      || (left.employee_name || '').localeCompare(right.employee_name || '')
    ));
};

const addMinutesToInput = (value, minutes) => {
  const date = new Date(`${value}:00+05:30`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return toAppDateTimeInput(date);
};

export const nextManualEntryRange = (selectedDate, entries = []) => {
  const completed = entries
    .filter((entry) => entry.ended_at && appDateKey(entry.ended_at) === selectedDate)
    .sort((left, right) => new Date(right.ended_at) - new Date(left.ended_at));
  const startedAt = completed[0]
    ? toAppDateTimeInput(completed[0].ended_at)
    : `${selectedDate}T09:00`;
  return {
    startedAt,
    endedAt: addMinutesToInput(startedAt, 60),
  };
};

export const suggestedBreakRange = (startedAt, endedAt) => {
  const start = new Date(`${startedAt}:00+05:30`);
  const end = new Date(`${endedAt}:00+05:30`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { startedAt, endedAt };
  }
  const durationMinutes = Math.floor((end - start) / 120000);
  const breakStartedAt = addMinutesToInput(startedAt, Math.max(0, durationMinutes - 15));
  const breakEndedAt = addMinutesToInput(breakStartedAt, Math.min(30, durationMinutes));
  return { startedAt: breakStartedAt, endedAt: breakEndedAt };
};
