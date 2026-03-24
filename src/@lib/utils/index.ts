// Utility functions

export * from './validation';
export * from './encryption';
export * from './json';

/**
 * Resolve a dot-notation path against a nested object.
 * Returns undefined if any segment is missing.
 * Example: getNestedValue({ header: { id: "INV-1" } }, "header.id") → "INV-1"
 */
export function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}

