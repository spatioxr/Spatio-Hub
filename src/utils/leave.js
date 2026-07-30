import { appDateDistance } from './timezone.js';
import { hasPermission, PERMISSIONS } from './rbac.js';

export const calculateLeaveDays = (fromDate, toDate, isHalfDay = false) => {
  if (!fromDate || !toDate) return 0;
  const distance = appDateDistance(fromDate, toDate);
  if (distance < 0) return 0;
  if (isHalfDay) return distance === 0 ? 0.5 : 0;
  return distance + 1;
};

export const canReviewLeave = (user) => (
  hasPermission(user, PERMISSIONS.APPROVE_LEAVE)
);
