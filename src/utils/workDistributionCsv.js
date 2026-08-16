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

export const buildWorkDistributionCsv = (entries, summary, downtimeEvents = []) => {
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
    `${summary.sessions} ${summary.sessions === 1 ? 'session' : 'sessions'} · ${summary.employees} active ${summary.employees === 1 ? 'employee' : 'employees'}`,
    '',
    '',
    formatDuration(summary.breakSeconds),
    Math.max(0, Math.floor(Number(summary.breakSeconds) || 0)),
    formatDuration(summary.workedSeconds),
    Math.max(0, Math.floor(Number(summary.workedSeconds) || 0)),
  ];

  const downtimeHeaders = [
    'ORGANISATION DOWNTIME',
    'Category',
    'Status',
    'Start (ISO 8601)',
    'End (ISO 8601)',
    'Recorded duration',
    'Recorded seconds',
    'Notes',
  ];
  const downtimeRows = downtimeEvents.map((event) => [
    event.title,
    event.category,
    event.event_status,
    isoTimestamp(event.started_at),
    isoTimestamp(event.ended_at),
    formatDuration(event.recorded_seconds),
    Math.max(0, Math.floor(Number(event.recorded_seconds) || 0)),
    event.notes || '',
  ]);
  const downtimeTotal = [
    'DOWNTIME TOTAL',
    '',
    '',
    '',
    '',
    formatDuration(summary.downtimeSeconds),
    Math.max(0, Math.floor(Number(summary.downtimeSeconds) || 0)),
    '',
  ];

  return `\uFEFF${[
    headers,
    ...rows,
    [],
    totalsRow,
    ...(downtimeEvents.length > 0 ? [
      [],
      downtimeHeaders,
      ...downtimeRows,
      downtimeTotal,
    ] : []),
  ].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
};
