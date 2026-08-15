export const shouldBlockForAuthEvent = ({
  event,
  currentAuthUserId,
  nextAuthUserId,
}) => (
  event === 'INITIAL_SESSION'
  || event === 'PASSWORD_RECOVERY'
  || Boolean(
    currentAuthUserId
    && nextAuthUserId
    && currentAuthUserId !== nextAuthUserId,
  )
);
