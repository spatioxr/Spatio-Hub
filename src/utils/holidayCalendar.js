export const calendarMonth = (year, month) => {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const offset = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`)];
};

export const holidaysInPeriod = (holidays, year, month = null) => {
  const prefix = month === null ? `${year}-` : `${year}-${String(month + 1).padStart(2, '0')}-`;
  return holidays.filter((holiday) => holiday.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
};

export const moveCalendarMonth = (year, month, offset) => {
  const date = new Date(Date.UTC(year, month + offset, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
};
