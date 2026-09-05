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
