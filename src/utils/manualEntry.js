import { addAppDays, appDateDistance, appDateTimeInputToIso } from './timezone.js';

export const moveManualEntryDate = (form, date) => {
  if (!date) return form;
  const offset = appDateDistance(form.startedAt.slice(0, 10), date);
  const shift = (value) => value ? `${addAppDays(value.slice(0, 10), offset)}T${value.slice(11)}` : value;
  return { ...form, startedAt: shift(form.startedAt), endedAt: shift(form.endedAt),
    breaks: form.breaks.map((entry) => ({ startedAt: shift(entry.startedAt), endedAt: shift(entry.endedAt) })) };
};

export const manualEntryPreview = (form, entries = [], employeeId, excludedId) => {
  const millis = (value) => {
    try { return value ? Date.parse(appDateTimeInputToIso(value)) : NaN; }
    catch { return NaN; }
  };
  const start = millis(form.startedAt);
  const end = millis(form.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: '', seconds: null };
  if (end <= start) return { error: 'To must be after From. For overnight work, choose a later end date.', seconds: null };
  const breaks = form.breaks.map((entry) => ({ start: millis(entry.startedAt), end: millis(entry.endedAt) })).sort((a, b) => a.start - b.start);
  if (breaks.some((entry, index) => !Number.isFinite(entry.start) || !Number.isFinite(entry.end)
    || entry.end <= entry.start || entry.start < start || entry.end > end
    || (index > 0 && entry.start < breaks[index - 1].end))) {
    return { error: 'Breaks must be within the entry, end after they start, and not overlap.', seconds: null };
  }
  const conflict = entries.some((entry) => entry.employee_id === employeeId && entry.work_entry_id !== excludedId
    && !entry.voided_at && start < (entry.ended_at ? Date.parse(entry.ended_at) : Infinity)
    && end > Date.parse(entry.started_at));
  return { error: conflict ? 'This time overlaps an existing entry for this person. Adjust From or To.' : '',
    seconds: (end - start - breaks.reduce((sum, entry) => sum + entry.end - entry.start, 0)) / 1000 };
};
