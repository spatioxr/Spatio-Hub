import { addAppDays } from './timezone.js';

export const holidayCalendarMonth = (month, holidays = []) => {
  const first = `${month.slice(0, 7)}-01`;
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay();
  const start = addAppDays(first, -((weekday + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = addAppDays(start, index);
    return {
      date,
      inMonth: date.slice(0, 7) === first.slice(0, 7),
      holidays: holidays.filter((holiday) => holiday.date === date),
    };
  });
};

export const shiftCalendarMonth = (month, offset) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1, 12)).toISOString().slice(0, 10);
};

const LEAVE_TYPES = Object.freeze([
  { type: 'Sick Leave', icon: 'ri-heart-pulse-line' },
  { type: 'Casual Leave', icon: 'ri-sun-cloudy-line' },
  { type: 'Comp Off', icon: 'ri-time-line' },
]);

export const dashboardLeaveAvailability = (requests = [], today) => {
  const approved = requests.filter((request) => {
    const from = request.from_date || request.from;
    const to = request.to_date || request.to;
    return request.status === 'Approved' && from && to && from <= to && to >= today;
  }).sort((a, b) => (a.from_date || a.from).localeCompare(b.from_date || b.from)
    || (a.employees?.name || '').localeCompare(b.employees?.name || ''));

  return {
    today: approved.filter((request) => (request.from_date || request.from) <= today),
    upcoming: approved.filter((request) => (request.from_date || request.from) > today),
  };
};

export const attendanceCompletionRate = (summary = {}) => {
  const workingDays = Math.max(0, Number(summary.workingDays || 0));
  if (!workingDays) return 0;

  const completed = Math.max(0, Number(summary.completedDays || 0));
  return Math.min(100, Math.round((completed / workingDays) * 100));
};

export const leaveBalanceSeries = (balance = {}) => LEAVE_TYPES.map(({ type, icon }) => {
  const used = Math.max(0, Number(balance[type]?.used || 0));
  const remaining = Math.max(0, Number(balance[type]?.remaining || 0));
  const pending = Math.max(0, Number(balance[type]?.pending || 0));
  const allocation = used + remaining;

  return {
    type,
    icon,
    used,
    remaining,
    pending,
    usedPercent: allocation ? Math.min(100, Math.round((used / allocation) * 100)) : 0,
  };
});

export const workdayPresentation = (status, hasWorkToday, contextLabel) => {
  if (status === 'working') {
    return {
      tone: 'working',
      icon: 'ri-pulse-line',
      title: 'Working now',
      description: contextLabel || 'Your active work context is being restored.',
    };
  }

  if (status === 'break') {
    return {
      tone: 'break',
      icon: 'ri-cup-line',
      title: 'Taking a break',
      description: contextLabel ? `Paused from ${contextLabel}` : 'Your work timer is paused.',
    };
  }

  if (hasWorkToday) {
    return {
      tone: 'complete',
      icon: 'ri-checkbox-circle-line',
      title: 'Workday complete',
      description: 'Your latest session is closed. You can reopen today from Track Work if needed.',
    };
  }

  return {
    tone: 'ready',
    icon: 'ri-play-circle-line',
    title: 'Ready when you are',
    description: 'Start your workday from Track Work when you are ready.',
  };
};
