export const PASSWORD_MIN_LENGTH = 12;

export const isStrongPassword = (password = '') => (
  password.length >= PASSWORD_MIN_LENGTH
  && /[a-z]/.test(password)
  && /[A-Z]/.test(password)
  && /\d/.test(password)
  && /[^A-Za-z0-9]/.test(password)
);

export const PASSWORD_REQUIREMENT_MESSAGE =
  'Use at least 12 characters with uppercase, lowercase, number, and symbol.';
