export const FEEDBACK_OPTIONS = [
  { value: 1, emoji: '😟', label: 'Very difficult' },
  { value: 2, emoji: '🙁', label: 'Difficult' },
  { value: 3, emoji: '😐', label: 'Okay' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '😄', label: 'Great' },
];
export const FEEDBACK_STATUS = { new: 'New', acknowledged: 'Acknowledged', followed_up: 'Followed up' };
export const feedbackError = (error) => ['PGRST202', '42P01', '42883'].includes(error?.code)
  ? 'Feedback is not available yet. Please try again later.'
  : error?.message || 'Unable to load feedback. Please try again.';
