const LEAVE_TYPES = Object.freeze([
  { type: 'Sick Leave', icon: 'ri-heart-pulse-line' },
  { type: 'Casual Leave', icon: 'ri-sun-cloudy-line' },
  { type: 'Comp Off', icon: 'ri-time-line' },
]);

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
