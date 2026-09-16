import { addAppDays, appDateDistance } from './timezone.js';

export const ANALYTICS_FILTER_KEYS = ['project', 'activity', 'department', 'employee'];
export const emptyAnalyticsFilters = () => Object.fromEntries(
  ANALYTICS_FILTER_KEYS.map((key) => [key, 'all']),
);

const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const validAnalyticsRange = (start, end, today) => (
  validDate(start) && validDate(end) && end <= today
  && appDateDistance(start, end) >= 0 && appDateDistance(start, end) < 31
);

export const readAnalyticsView = (search, today) => {
  const params = new URLSearchParams(search);
  const start = params.get('start');
  const end = params.get('end');
  return {
    range: validAnalyticsRange(start, end, today)
      ? { start, end }
      : { start: addAppDays(today, -6), end: today },
    filters: Object.fromEntries(ANALYTICS_FILTER_KEYS.map((key) => (
      [key, params.get(key) || 'all']
    ))),
  };
};

export const writeAnalyticsView = (search, view) => {
  const params = new URLSearchParams(search);
  params.set('start', view.range.start);
  params.set('end', view.range.end);
  ANALYTICS_FILTER_KEYS.forEach((key) => {
    if (view.filters[key] && view.filters[key] !== 'all') params.set(key, view.filters[key]);
    else params.delete(key);
  });
  return params;
};

export const changeAnalyticsFilter = (filters, key, value, toggle = false) => ({
  ...filters,
  [key]: toggle && filters[key] === value ? 'all' : value,
});

// A period without matching work must not silently reset a retained selection.
export const retainAnalyticsOption = (options, value, label) => (
  value === 'all' || options.some((option) => option.value === value)
    ? options
    : [...options, { value, label: label || 'Selected (no entries in this period)' }]
);
