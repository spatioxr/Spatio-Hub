export const liveStatusTimeDetails = ({
  attendanceAvailable,
  breakStartedAt,
  checkedInAt,
  checkedOutAt,
  workStatus,
}) => {
  if (!attendanceAvailable) {
    return [{ label: 'Attendance time unavailable', value: null }];
  }

  if (!checkedInAt) {
    return [{ label: 'No activity today', value: null }];
  }

  const details = [{ label: 'Checked in', value: checkedInAt }];

  if (workStatus === 'Break' && breakStartedAt) {
    details.push({ label: 'Break since', value: breakStartedAt });
  }

  if (workStatus === 'Out' && checkedOutAt) {
    details.push({ label: 'Checked out', value: checkedOutAt });
  }

  return details;
};
