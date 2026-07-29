export const APP_TIME_ZONE = 'Asia/Kolkata';
export const APP_TIME_ZONE_LABEL = 'IST';
export const APP_UTC_OFFSET = '+05:30';

const asDate = (value) => (value instanceof Date ? value : new Date(value));

const dateParts = (value) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(asDate(value))
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value: partValue }) => [type, partValue]),
);

const dateOnlyValue = (value) => (
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00${APP_UTC_OFFSET}`
    : value
);

const uppercaseDayPeriod = (value) => value.replace(/\b(am|pm)\b/gi, (period) => (
  period.toUpperCase()
));

export const appDateKey = (value = new Date()) => {
  const { year, month, day } = dateParts(value);
  return `${year}-${month}-${day}`;
};

export const addAppDays = (dateKey, days) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
};

export const appDateDistance = (startDate, endDate) => {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
};

export const appDayStartIso = (dateKey) => (
  new Date(`${dateKey}T00:00:00${APP_UTC_OFFSET}`).toISOString()
);

export const appDayRange = (startDate, endDateInclusive) => ({
  start: appDayStartIso(startDate),
  end: appDayStartIso(addAppDays(endDateInclusive, 1)),
});

export const formatAppClock = (value, fallback = 'Now') => (
  value
    ? uppercaseDayPeriod(new Intl.DateTimeFormat('en-IN', {
      timeZone: APP_TIME_ZONE,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(asDate(value)))
    : fallback
);

export const formatAppTimeValue = (value, fallback = '-') => (
  value
    ? formatAppClock(`2000-01-01T${value}${APP_UTC_OFFSET}`, fallback)
    : fallback
);

export const formatAppDate = (value, options = {}) => (
  new Intl.DateTimeFormat('en-IN', {
    timeZone: APP_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  }).format(asDate(dateOnlyValue(value)))
);

export const formatAppDateTime = (value, fallback = 'Not recorded') => (
  value
    ? `${formatAppDate(value)}, ${formatAppClock(value, fallback)}`
    : fallback
);

export const toAppDateTimeInput = (value) => {
  if (!value) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(asDate(value))
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value: partValue }) => [type, partValue]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export const appDateTimeInputToIso = (value) => (
  value ? new Date(`${value}${APP_UTC_OFFSET}`).toISOString() : ''
);
