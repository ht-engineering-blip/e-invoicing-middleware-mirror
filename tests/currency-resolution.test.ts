import { describe, expect, it } from "bun:test";
import { Currency } from "../src/@lib/adapters/firs/types";
import {
  resolveCurrencyCode,
  setDynamicCurrencies,
} from "../src/v1/workflow/utils/transformer/utils";

describe("Currency Resolution & Validation Tests", () => {
  const mockCurrencies: Currency[] = [
    {
      symbol: "$",
      name: "US Dollar",
      symbol_native: "$",
      decimal_digits: 2,
      rounding: 0,
      code: "USD",
      name_plural: "US dollars",
    },
    {
      symbol: "CA$",
      name: "Canadian Dollar",
      symbol_native: "$",
      decimal_digits: 2,
      rounding: 0,
      code: "CAD",
      name_plural: "Canadian dollars",
    },
    {
      symbol: "€",
      name: "Euro",
      symbol_native: "€",
      decimal_digits: 2,
      rounding: 0,
      code: "EUR",
      name_plural: "euros",
    },
    {
      symbol: "₦",
      name: "Nigerian Naira",
      symbol_native: "₦",
      decimal_digits: 2,
      rounding: 0,
      code: "NGN",
      name_plural: "Nigerian nairas",
    },
    {
      symbol: "AED",
      name: "United Arab Emirates Dirham",
      symbol_native: "د.إ.",
      decimal_digits: 2,
      rounding: 0,
      code: "AED",
      name_plural: "UAE dirhams",
    },
  ];

  it("should resolve exact 3-letter currency codes", () => {
    expect(resolveCurrencyCode("USD", mockCurrencies)).toBe("USD");
    expect(resolveCurrencyCode("usd", mockCurrencies)).toBe("USD");
    expect(resolveCurrencyCode("ngn", mockCurrencies)).toBe("NGN");
    expect(resolveCurrencyCode("eur", mockCurrencies)).toBe("EUR");
    expect(resolveCurrencyCode("cad", mockCurrencies)).toBe("CAD");
    expect(resolveCurrencyCode("aed", mockCurrencies)).toBe("AED");
  });

  it("should resolve currency symbols to standard currency code", () => {
    expect(resolveCurrencyCode("₦", mockCurrencies)).toBe("NGN");
    expect(resolveCurrencyCode("€", mockCurrencies)).toBe("EUR");
    expect(resolveCurrencyCode("CA$", mockCurrencies)).toBe("CAD");
    expect(resolveCurrencyCode("د.إ.", mockCurrencies)).toBe("AED");
  });

  it("should resolve currency names to standard currency code", () => {
    expect(resolveCurrencyCode("Nigerian Naira", mockCurrencies)).toBe("NGN");
    expect(resolveCurrencyCode("US Dollar", mockCurrencies)).toBe("USD");
    expect(resolveCurrencyCode("euros", mockCurrencies)).toBe("EUR");
    expect(resolveCurrencyCode("Canadian dollars", mockCurrencies)).toBe("CAD");
  });

  it("should fallback to NGN when input is undefined or empty", () => {
    expect(resolveCurrencyCode(undefined, mockCurrencies)).toBe("NGN");
    expect(resolveCurrencyCode("", mockCurrencies)).toBe("NGN");
    expect(resolveCurrencyCode(null as any, mockCurrencies)).toBe("NGN");
  });

  it("should work with setDynamicCurrencies global cache", () => {
    setDynamicCurrencies(mockCurrencies);
    expect(resolveCurrencyCode("USD")).toBe("USD");
    expect(resolveCurrencyCode("€")).toBe("EUR");
    expect(resolveCurrencyCode("")).toBe("NGN");
  });
});
