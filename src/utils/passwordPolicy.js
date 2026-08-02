export const PASSWORD_MIN_LENGTH = 8;

export const isStrongPassword = (password = '') => password.length >= PASSWORD_MIN_LENGTH;

export const PASSWORD_REQUIREMENT_MESSAGE =
  'Use at least 8 characters.';
