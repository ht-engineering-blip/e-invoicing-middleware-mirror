import { Currency } from "../../../../@lib/adapters/firs/types";

/**
 * Sanitize an HSN code to the FIRS-required format: digits + "." + exactly 2 decimal digits.
 * Handles: pure digits ("8517" → "8517.00"), missing decimals ("8517." → "8517.00"),
 * single decimal ("8517.1" → "8517.10"), extra decimals ("8517.123" → "8517.12"),
 * and non-digit characters. Returns undefined for empty/invalid input so the field
 * stays optional.
 */
export function sanitizeHsnCode(val: unknown): string | undefined {
  if (val === undefined || val === null) {
    return undefined;
  }

  let str = String(val).trim();
  if (str === "") {
    return undefined;
  }

  // If it has letters, treat it as a custom/non-numeric HSN code and don't sanitize/format it
  if (/[a-zA-Z]/.test(str)) {
    return undefined;
  }

  // Strip any non-digit/non-dot characters
  str = str.replace(/[^\d.]/g, "");
  if (!str || str === ".") {
    return undefined;
  }

  // Pure digits → append .00
  if (/^\d+$/.test(str)) {
    return `${str}.00`;
  } else if (/^\d+\.$/.test(str)) {
    // Trailing dot, no decimals → append 00
    return `${str}00`;
  } else if (/^\d+\.\d$/.test(str)) {
    // One decimal digit → append 0
    return `${str}0`;
  } else if (/^\d+\.\d{2}$/.test(str)) {
    // Already valid → return as-is
    return str;
  } else {
    // More than 2 decimal digits → truncate to 2
    const match = str.match(/^(\d+\.\d{2})/);
    if (match) {
      return match[1];
    }
  }

  return "0000.00";
}

let dynamicQuantityCodes: Set<string> | null = null;
let dynamicHsCodes: Array<{
  code: string;
  label?: string;
  keywords?: string[];
}> | null = null;
let dynamicCurrencies: Currency[] | null = null;

export function setDynamicQuantityCodes(
  codes: Array<{ code: string; value?: string }>,
): void {
  if (Array.isArray(codes) && codes.length > 0) {
    dynamicQuantityCodes = new Set(
      codes.map((c) => c.code.toUpperCase().trim()),
    );
  }
}

export function setDynamicHsCodes(
  codes: Array<{ code: string; label?: string; keywords?: string[] }>,
): void {
  if (Array.isArray(codes) && codes.length > 0) {
    dynamicHsCodes = codes;
  }
}

export function setDynamicCurrencies(currencies: Currency[]): void {
  if (Array.isArray(currencies) && currencies.length > 0) {
    dynamicCurrencies = currencies;
  }
}

export function getDynamicCurrencies(): Currency[] | null {
  return dynamicCurrencies;
}

/**
 * Resolve currency code from input (can be code e.g. "USD", symbol e.g. "$", or name e.g. "US Dollar")
 * using the dynamic FIRS currencies list from GET /api/v1/invoice/resources/currencies.
 * Fallbacks to NGN or first available currency code.
 */
export function resolveCurrencyCode(
  input?: string,
  availableCurrencies?: Currency[] | null,
): string {
  let currencies: Currency[] | null = null;
  if (availableCurrencies && availableCurrencies.length > 0) {
    currencies = availableCurrencies;
  } else if (dynamicCurrencies && dynamicCurrencies.length > 0) {
    currencies = dynamicCurrencies;
  }

  let defaultCurrency = "NGN";
  if (currencies && currencies.length > 0) {
    const foundNgn = currencies.find(
      (c) => c.code && c.code.toUpperCase() === "NGN",
    );
    if (foundNgn && foundNgn.code) {
      defaultCurrency = foundNgn.code;
    } else if (currencies[0]?.code) {
      defaultCurrency = currencies[0].code;
    }
  }

  if (!input || typeof input !== "string") return defaultCurrency;

  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();

  if (!currencies || currencies.length === 0) {
    if (upper !== "") {
      return upper;
    } else {
      return defaultCurrency;
    }
  }

  // 1. Direct code match (e.g. "USD", "ngn", "EUR")
  const matchByCode = currencies.find(
    (c) => c.code && c.code.toUpperCase() === upper,
  );
  if (matchByCode && matchByCode.code) {
    return matchByCode.code;
  }

  // 2. Match by symbol or native symbol (e.g. "$", "₦", "€", "CA$")
  const matchBySymbol = currencies.find(
    (c) =>
      (c.symbol && c.symbol.trim() === trimmed) ||
      (c.symbol_native && c.symbol_native.trim() === trimmed),
  );
  if (matchBySymbol && matchBySymbol.code) {
    return matchBySymbol.code;
  }

  // 3. Match by name or plural name (e.g. "US Dollar", "Nigerian Naira", "euros")
  const lower = trimmed.toLowerCase();
  const matchByName = currencies.find(
    (c) =>
      (c.name && c.name.toLowerCase() === lower) ||
      (c.name_plural && c.name_plural.toLowerCase() === lower),
  );
  if (matchByName && matchByName.code) return matchByName.code;

  // 4. If input matches 3-letter currency code pattern
  if (/^[A-Z]{3}$/.test(upper)) return upper;

  return defaultCurrency;
}

/**
 * Map common free-text / currency-style price_unit values produced by LLMs
 * to their correct UN/ECE unit codes using dynamic FIRS quantity codes.
 */
export function sanitizePriceUnit(val: unknown): string {
  if (!val || typeof val !== "string") {
    if (dynamicQuantityCodes && dynamicQuantityCodes.size > 0) {
      return Array.from(dynamicQuantityCodes)[0];
    }
    return "H87";
  }

  const s = val.trim().toUpperCase();

  if (dynamicQuantityCodes && dynamicQuantityCodes.size > 0) {
    if (dynamicQuantityCodes.has(s)) {
      return s;
    }

    const base = s.replace(/\s*(PER|\/)\s*[\d\w]+.*$/, "").trim();
    if (dynamicQuantityCodes.has(base)) {
      return base;
    }

    return Array.from(dynamicQuantityCodes)[0];
  }

  return s;
}

/**
 * Find the best matching real WCO/HS code for a given product or service description.
 * Searches the lookup table by keyword matching and returns the HS code in FIRS format
 * (4-digit heading + ".00"), e.g., "8471.00" for computers.
 *
 * @param description - The product category, service category or item description to look up
 * @returns A valid HS code string in FIRS format, or a safe default if no match found
 */
export function lookupHsnCode(description: string): string {
  if (!description || typeof description !== "string") {
    return "9999.00";
  }

  const normalized = description.toLowerCase().trim();

  if (dynamicHsCodes && dynamicHsCodes.length > 0) {
    let bestMatch: { code: string; score: number } | undefined = undefined;

    for (const entry of dynamicHsCodes) {
      if (!entry) continue;
      let score = 0;
      const targetText =
        `${entry.label || ""} ${(entry.keywords || []).join(" ")}`.toLowerCase();

      if (entry.code.toLowerCase() === normalized) {
        score = 100;
      } else if (targetText.includes(normalized)) {
        score = 50;
      } else {
        const words = normalized.split(/\s+/);
        for (const word of words) {
          if (word.length > 2 && targetText.includes(word)) {
            score += 10;
          }
        }
      }

      if (score > 0) {
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { code: entry.code, score };
        }
      }
    }

    if (bestMatch && bestMatch.code) {
      const sanitized = sanitizeHsnCode(bestMatch.code);
      if (sanitized) {
        return sanitized;
      }
    }
  }

  return "9999.00";
}

/**
 * Generate a unique HSN code not already present in the usedCodes set,
 * based on the line description or standard fallback heading.
 */
export function generateUniqueHsnCode(
  usedCodes: Set<string>,
  description?: string,
): string {
  let baseCode = "9999.00";
  if (
    description &&
    typeof description === "string" &&
    description.trim() !== ""
  ) {
    baseCode = lookupHsnCode(description);
  }

  if (!usedCodes.has(baseCode)) {
    usedCodes.add(baseCode);
    return baseCode;
  }

  const prefix = baseCode.split(".")[0] || "9999";
  for (let i = 1; i <= 99; i++) {
    const candidate = `${prefix}.${String(i).padStart(2, "0")}`;
    if (!usedCodes.has(candidate)) {
      usedCodes.add(candidate);
      return candidate;
    }
  }

  return baseCode;
}
