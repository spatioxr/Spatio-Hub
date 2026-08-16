export const DOWNTIME_CATEGORIES = Object.freeze([
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'power_cut', label: 'Power cut' },
  { value: 'company_event', label: 'Company event' },
  { value: 'other', label: 'Other' },
]);

export const downtimeCategoryLabel = (value) => (
  DOWNTIME_CATEGORIES.find((category) => category.value === value)?.label || 'Other'
);

export const formatDowntimeDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
};

export const sumDowntimeSeconds = (events = []) => events.reduce(
  (total, event) => total + Math.max(0, Number(event.recorded_seconds) || 0),
  0,
);

export const downtimeStatusLabel = (status) => {
  if (status === 'active') return 'Active now';
  if (status === 'scheduled') return 'Scheduled';
  return 'Completed';
};

export const validateDowntimeRange = (startedAt, endedAt) => {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Choose a valid start and end time.';
  }
  if (end <= start) return 'End time must be after the start time.';
  return '';
};
