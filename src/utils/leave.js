import { addAppDays, appDateDistance } from './timezone.js';
import { hasPermission, PERMISSIONS } from './rbac.js';

export const isCompanyWorkingDay = (date, holidays = []) => {
  if (!date) return false;
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const holidayDates = new Set(holidays.map((holiday) => (
    typeof holiday === 'string' ? holiday : holiday.date
  )));
  return weekday !== 0 && weekday !== 6 && !holidayDates.has(date);
};

export const calculateLeaveDays = (
  fromDate,
  toDate,
  isHalfDay = false,
  holidays = [],
) => {
  if (!fromDate || !toDate) return 0;
  const distance = appDateDistance(fromDate, toDate);
  if (distance < 0) return 0;
  if (isHalfDay) {
    return distance === 0 && isCompanyWorkingDay(fromDate, holidays) ? 0.5 : 0;
  }

  let workingDays = 0;
  for (let date = fromDate; date <= toDate; date = addAppDays(date, 1)) {
    if (isCompanyWorkingDay(date, holidays)) workingDays += 1;
  }
  return workingDays;
};

export const canReviewLeave = (user) => (
  hasPermission(user, PERMISSIONS.APPROVE_LEAVE)
);

export const previewBalanceAdjustment = (currentBalance, amount, operation) => {
  const current = Number(currentBalance);
  const days = Number(amount);
  if (currentBalance == null || !Number.isFinite(current)
    || !Number.isFinite(days) || days <= 0 || days % 0.5 !== 0
    || !['add', 'remove'].includes(operation)) return null;
  const delta = operation === 'remove' ? -days : days;
  const remaining = current + delta;
  return { current, delta, remaining, valid: remaining >= 0 };
};

// Date filters match requests overlapping the selected leave period.
export const filterLeaveHistory = (requests, { search = '', status = '', from = '', to = '' }) => {
  const query = search.trim().toLowerCase();
  if (from && to && from > to) return [];
  return requests.filter((request) => (
    (!query || [request.employee_name, request.employee_code, request.employee_department]
      .some((value) => String(value || '').toLowerCase().includes(query)))
    && (!status || request.status === status)
    && (!from || request.to_date >= from)
    && (!to || request.from_date <= to)
  ));
};
