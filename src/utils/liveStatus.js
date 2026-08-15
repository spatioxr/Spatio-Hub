const parseTimestamp = (value) => {
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

export const statusSinceLabel = (workStatus) => {
  if (workStatus === 'In') return 'Context since';
  if (workStatus === 'Break') return 'Break since';
  if (workStatus === 'Out') return 'Out since';
  return 'Since';
};

export const shouldShowStatusSince = ({
  firstCheckInAt,
  statusStartedAt,
  workStatus,
}) => {
  const statusTimestamp = parseTimestamp(statusStartedAt);
  if (statusTimestamp === null) return false;

  if (workStatus !== 'In') return true;

  const checkInTimestamp = parseTimestamp(firstCheckInAt);
  if (checkInTimestamp === null) return true;

  return statusTimestamp !== checkInTimestamp;
};
