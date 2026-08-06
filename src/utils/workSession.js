export const getWorkStatus = ({ session, breakEntry } = {}) => {
  if (!session) return 'out';
  return breakEntry ? 'break' : 'working';
};

export const isTaskDescriptionValid = (taskDescription, required = true) => (
  !required || Boolean(taskDescription?.trim())
);

export const getElapsedSeconds = ({
  session,
  breakEntry,
  workedSeconds = 0,
  syncedAt,
} = {}, now = Date.now()) => {
  const completedSeconds = Math.max(0, Math.floor(Number(workedSeconds) || 0));

  if (!session || breakEntry || !Number.isFinite(syncedAt)) {
    return completedSeconds;
  }

  const secondsSinceSync = Math.max(0, Math.floor((now - syncedAt) / 1000));
  return completedSeconds + secondsSinceSync;
};
