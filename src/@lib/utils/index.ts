// Utility functions

export * from './validation';
export * from './encryption';
export * from './json';
export * from './ssrf';

import { appConfig } from '../../@config';

/**
 * Build the public URL for an invoice's QR code image.
 * Returns null when the invoice has no qrCode stored yet.
 *
 * Format: <API_BASE_URL>/v1/invoice/<IRN>/qr
 */
export function buildQrUrl(irn: string | undefined, hasQrCode: boolean): string | null {
  if (!irn || !hasQrCode) return null;
  const base = (appConfig?.apiBaseURL ?? '').replace(/\/$/, '');
  return `${base}/v1/invoice/${encodeURIComponent(irn)}/qr`;
}



/**
 * Resolve a dot-notation path against a nested object.
 * Returns undefined if any segment is missing.
 * Example: getNestedValue({ header: { id: "INV-1" } }, "header.id") → "INV-1"
 */
export function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
}



/**
 * Resolve a dot-notation (or bracket-notation) path against a nested object/array.
 * Returns undefined if any segment is missing.
 *
 * Supports:
 *   "header.id"            → plain nested object
 *   "items[0].description" → array index access
 *   "items.0.description"  → same, dot-notation index
 *   "items[*].description" → returns array of values from every element
 *
 * Examples:
 *   getNestedValue({ header: { id: "INV-1" } }, "header.id") → "INV-1"
 *   getNestedValue({ items: [{ qty: 2 }, { qty: 5 }] }, "items[*].qty") → [2, 5]
 */
export function _getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  // Normalise bracket notation → dot notation, trim each segment, drop blanks
  const keys = path
    .replace(/\[(\d+|\*)\]/g, '.$1')
    .split('.')
    .map(k => k.trim())
    .filter(k => k.length > 0);
  if (keys.length === 0) return undefined;
  return _traverse(obj, keys);
}

function _traverse(current: any, keys: string[]): any {
  if (keys.length === 0) return current;
  if (current == null) return undefined;
  const [head, ...rest] = keys;
  if (head === '*') {
    if (!Array.isArray(current)) return undefined;
    const results = current.map((item: any) => _traverse(item, rest)).filter((v: any) => v !== undefined);
    return results.length === 0 ? undefined : results.length === 1 ? results[0] : results;
  }
  return _traverse(current[head], rest);
}

