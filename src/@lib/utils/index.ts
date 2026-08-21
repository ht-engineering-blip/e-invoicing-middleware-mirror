// Utility functions

export * from "./validation";
export * from "./encryption";
export * from "./json";
export * from "./ssrf";
export * from "./response";

import { appConfig } from "../../@config";
import { AutocompletePaths } from "../types";

/**
 * Build the public URL for an invoice's QR code image.
 * Returns null when the invoice has no qrCode stored yet.
 *
 * Format: <API_BASE_URL>/v1/invoice/<IRN>/qr
 */
export function buildQrUrl(
  irn: string | undefined,
  hasQrCode: boolean,
): string | null {
  if (!irn || !hasQrCode) return null;
  const base = (appConfig?.apiBaseURL ?? "").replace(/\/$/, "");
  return `${base}/v1/invoice/${encodeURIComponent(irn)}/qr`;
}

/**
 * Resolve a dot-notation (or bracket-notation) path against a nested object/array.
 * Returns undefined if any segment is missing.
 *
 * Supports:
 *   "header.id"                    → plain nested object
 *   "data.billing_reference[0]"   → array index access
 *   "items.0.description"          → same, dot-notation index
 *   "items[*].description"         → returns array of values from every element
 *
 * Examples:
 *   getNestedValue({ header: { id: "INV-1" } }, "header.id") → "INV-1"
 *   getNestedValue({ data: { billing_reference: [{ irn: "123" }] } }, "data.billing_reference[0]") → { irn: "123" }
 */
export function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  // Normalise bracket notation → dot notation, trim each segment, drop blanks
  const keys = path
    .replace(/\[(\d+|\*)\]/g, ".$1")
    .split(".")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  if (keys.length === 0) return undefined;
  return _traverse(obj, keys);
}

export const _getNestedValue = getNestedValue;

function _traverse(current: any, keys: string[]): any {
  if (keys.length === 0) return current;
  if (current == null) return undefined;
  const [head, ...rest] = keys;
  if (head === "*") {
    if (!Array.isArray(current)) return undefined;
    const results = current
      .map((item: any) => _traverse(item, rest))
      .filter((v: any) => v !== undefined);
    return results.length === 0
      ? undefined
      : results.length === 1
        ? results[0]
        : results;
  }
  return _traverse(current[head], rest);
}

/**
 * Safely escape HTML characters to prevent XSS (Cross-Site Scripting).
 */
export function escapeHtml(unsafe: string | undefined | null): string {
  if (unsafe == null) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Tagged template literal helper that automatically HTML-escapes all interpolated variables.
 */
export function html(strings: TemplateStringsArray, ...values: any[]): string {
  return strings.reduce((result, string, i) => {
    const value = values[i - 1];
    const escapedValue =
      typeof value === "string" ? escapeHtml(value) : String(value ?? "");
    return result + escapedValue + string;
  });
}

const DEFAULT_SENSITIVE_KEYS = [
  "password",
  "passwordChange",
  "passwordChangedAt",
  "privateKey",
  "clientSecret",
  "certificate",
  "apiKey",
  "apiSecret",
];

/**
 * Omit keys recursively from an object, Mongoose document, or array of objects.
 *
 * @param data - The object or array of objects to filter
 * @param keysToOmit - List of keys to exclude (defaults to standard sensitive fields)
 */
export function omitKeys<T>(
  data: T,
  keysToOmit: AutocompletePaths<T>[] = DEFAULT_SENSITIVE_KEYS as AutocompletePaths<T>[],
  currentPath: string = "",
): T {
  if (data == null) return data;

  if (Array.isArray(data)) {
    return data.map((item) => omitKeys(item, keysToOmit, currentPath)) as T;
  }

  if (typeof data === "object") {
    // Convert Mongoose Document to plain object if toObject method exists
    let obj: Record<string, unknown>;
    const target = data as { toObject?: () => Record<string, unknown> };
    if (typeof target.toObject === "function") {
      obj = target.toObject();
    } else {
      obj = { ...(data as Record<string, unknown>) };
    }

    const result: Record<string, unknown> = {};
    const omitList = keysToOmit as string[];
    for (const key of Object.keys(obj)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        continue;
      }
      const keyPath = currentPath ? `${currentPath}.${key}` : key;
      if (omitList.includes(key) || omitList.includes(keyPath)) {
        continue;
      }

      const val = obj[key];
      if (
        val !== null &&
        typeof val === "object" &&
        !(val instanceof Date) &&
        !(val instanceof RegExp)
      ) {
        result[key] = omitKeys(
          val,
          keysToOmit as AutocompletePaths<unknown>[],
          keyPath,
        );
      } else {
        result[key] = val;
      }
    }
    return result as T;
  }

  return data;
}
