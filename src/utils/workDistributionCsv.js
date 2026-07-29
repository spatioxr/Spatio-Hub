const neutralizeFormula = (value) => {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};

const csvCell = (value) => `"${neutralizeFormula(value).replace(/"/g, '""')}"`;

const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
};

const isoTimestamp = (value) => (
  value ? new Date(value).toISOString() : ''
);

export const workDistributionCsvFilename = ({ start, end }) => (
  `spatio-work-distribution_${start}_to_${end}.csv`
);

export const buildWorkDistributionCsv = (entries, summary) => {
  const headers = [
    'Employee',
    'Employee code',
    'Department',
    'Context type',
    'Project / activity',
    'Task',
    'Start (ISO 8601)',
    'End (ISO 8601)',
    'Break duration',
    'Break seconds',
    'Worked duration',
    'Worked seconds',
  ];

  const rows = entries.map((entry) => [
    entry.employee_name,
    entry.employee_code,
    entry.employee_department || 'Not assigned',
    entry.context_type === 'project' ? 'Project' : 'Activity',
    entry.context_label,
    entry.task_description || '',
    isoTimestamp(entry.started_at),
    isoTimestamp(entry.ended_at),
    formatDuration(entry.break_seconds),
    Math.max(0, Math.floor(Number(entry.break_seconds) || 0)),
    formatDuration(entry.worked_seconds),
    Math.max(0, Math.floor(Number(entry.worked_seconds) || 0)),
  ]);

  const totalsRow = [
    'TOTALS',
    '',
    '',
    '',
    '',
    `${summary.sessions} sessions · ${summary.employees} active employees`,
    '',
    '',
    formatDuration(summary.breakSeconds),
    Math.max(0, Math.floor(Number(summary.breakSeconds) || 0)),
    formatDuration(summary.workedSeconds),
    Math.max(0, Math.floor(Number(summary.workedSeconds) || 0)),
  ];

  return `\uFEFF${[
    headers,
    ...rows,
    [],
    totalsRow,
  ].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
};
