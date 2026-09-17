import { addAppDays } from './timezone.js';

export const monthShift = (date, step) => {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + step);
  return d.toISOString().slice(0, 10);
};
export const periodRange = (mode, anchor, today) => {
  let start, end;
  if (mode === 'month') {
    start = `${anchor.slice(0, 7)}-01`;
    end = addAppDays(monthShift(start, 1), -1);
  } else {
    const weekday = new Date(`${anchor}T12:00:00Z`).getUTCDay();
    start = addAppDays(anchor, -((weekday + 6) % 7));
    end = addAppDays(start, 6);
  }
  return { start, end: end > today ? today : end };
};
export const splitAnalyticsRange = (start, end, size = 31) => {
  const chunks = [];
  for (let next = start; next <= end;) {
    const last = addAppDays(next, size - 1);
    chunks.push({ start: next, end: last < end ? last : end });
    next = addAppDays(last, 1);
  }
  return chunks;
};
export const aggregateAnalyticsEntries = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.employee_id, row.context_type, row.context_id]);
    const item = groups.get(key) || { employee_id: row.employee_id, employee_name: row.employee_name, employee_code: row.employee_code, employee_department: row.employee_department, context_type: row.context_type, context_id: row.context_id, context_label: row.context_label, worked_seconds: 0, break_seconds: 0, session_count: 0 };
    item.worked_seconds += Number(row.worked_seconds) || 0;
    item.break_seconds += Number(row.break_seconds) || 0;
    item.session_count += Number(row.session_count) || 1;
    groups.set(key, item);
  }
  return [...groups.values()];
};
