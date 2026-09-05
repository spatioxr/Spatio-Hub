export const reportSubmissionStatus = (report, kind) => {
  if (report[`${kind}_report`]?.trim()) return 'Submitted';
  if (report[`${kind}_required`] === false) return 'Currently exempt';
  return 'Pending';
};

export const filterDailyReviews = (reports, { employeeId, department, date }) => (
  reports.filter((report) => (
    (!employeeId || employeeId === 'all' || report.employee_id === employeeId)
    && (!department || department === 'all' || report.employee_department === department)
    && (!date || report.report_date === date)
  ))
);

// Reports are point events; sessions and breaks retain their factual durations.
export const buildDayTimeline = (entries, reports) => {
  const events = entries.flatMap((entry) => [
    { type: 'session', key: `session:${entry.work_entry_id}`, at: entry.started_at, entry },
    ...(entry.breaks || []).map((pause) => ({
      type: 'break', key: `break:${pause.id}`, at: pause.started_at, entry, pause,
    })),
  ]);
  reports.forEach((report) => {
    ['bos', 'eod'].forEach((kind) => {
      if (!report[`${kind}_report`]?.trim()) return;
      events.push({
        type: kind, key: `${kind}:${report.employee_id}:${report.report_date}`,
        at: report[`${kind}_submitted_at`], report,
      });
    });
  });
  const order = { bos: 0, session: 1, break: 2, eod: 3 };
  return events.sort((a, b) => {
    // Never invent a submission time for imported/legacy reports.
    const timeA = a.at ? Date.parse(a.at) : Infinity;
    const timeB = b.at ? Date.parse(b.at) : Infinity;
    return (timeA === timeB ? 0 : timeA - timeB)
      || order[a.type] - order[b.type] || a.key.localeCompare(b.key);
  });
};

export const missingReportSummary = (reports) => {
  const labels = { bos: 'Start-of-day plan', eod: 'End-of-day summary' };
  return ['bos', 'eod'].flatMap((kind) => {
    const missing = reports.filter((report) => reportSubmissionStatus(report, kind) !== 'Submitted');
    if (!missing.length) return [];
    if (reports.length === 1) return [`${labels[kind]}: ${reportSubmissionStatus(missing[0], kind).toLowerCase()}`];
    const exempt = missing.filter((report) => report[`${kind}_required`] === false).length;
    const pending = missing.length - exempt;
    return [`${labels[kind]}: ${[pending && `${pending} pending`, exempt && `${exempt} currently exempt`].filter(Boolean).join(', ')}`];
  }).join(' · ');
};
