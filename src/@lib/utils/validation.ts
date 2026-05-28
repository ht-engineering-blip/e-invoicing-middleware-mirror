// Validation utilities

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isValidPhone = (phone: string): boolean => {
  const phoneRegex = /^\+?[\d\s-()]+$/;
  return phoneRegex.test(phone) && phone.replace(/\D/g, '').length >= 10;
};

/**
 * Safely escapes all regex metacharacters in a string to prevent ReDoS and injection.
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generates a safe RegExp anchored to the start of the string to avoid arbitrary backtracking.
 */
export function safeSearchRegExp(query: string, flags: string = 'i'): RegExp {
  const escaped = escapeRegExp(query);
  return new RegExp('^' + escaped, flags);
}

