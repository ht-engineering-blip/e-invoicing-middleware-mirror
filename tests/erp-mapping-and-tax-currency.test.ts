import { describe, expect, it, beforeAll } from "bun:test";
import { normalizeInvoicePayload } from "../src/v1/workflow/utils/transformer/payload-normalizer";
import { setDynamicCurrencies } from "../src/v1/workflow/utils/transformer/utils";
import { Currency } from "../src/@lib/adapters/firs/types";

describe("ERP Mapping Rules and Tax Currency Validation Fixes", () => {
  beforeAll(() => {
    const mockCurrencies: Currency[] = [
      { code: "NGN", name: "Nigerian Naira", symbol: "₦", symbol_native: "₦", name_plural: "Nigerian nairas", decimal_digits: 2, rounding: 0 },
      { code: "USD", name: "US Dollar", symbol: "$", symbol_native: "$", name_plural: "US dollars", decimal_digits: 2, rounding: 0 },
      { code: "EUR", name: "Euro", symbol: "€", symbol_native: "€", name_plural: "euros", decimal_digits: 2, rounding: 0 },
    ];
    setDynamicCurrencies(mockCurrencies);
  });

  it("should normalize currency codes when payload only specifies text currency or alias", () => {
    const payloadWithTextCurrency = {
      business_id: "test-biz",
      currency: "Nigerian Naira",
      invoice_line: [
        {
          item: { name: "Test Item" },
          price: { price_amount: 1000 },
          invoiced_quantity: 1,
        },
      ],
    };

    const normalized = normalizeInvoicePayload(payloadWithTextCurrency as any);
    expect(normalized.document_currency_code).toBe("NGN");
    expect(normalized.tax_currency_code).toBe("NGN");
  });

  it("should normalize currency when currency is specified as 'usd' or 'EUR' or symbol", () => {
    const payloadWithUSD = {
      business_id: "test-biz",
      currency_code: "usd",
      invoice_line: [],
    };

    const normalizedUSD = normalizeInvoicePayload(payloadWithUSD as any);
    expect(normalizedUSD.document_currency_code).toBe("USD");
    expect(normalizedUSD.tax_currency_code).toBe("USD");

    const payloadWithSymbol = {
      business_id: "test-biz",
      currency: "€",
      invoice_line: [],
    };

    const normalizedSymbol = normalizeInvoicePayload(payloadWithSymbol as any);
    expect(normalizedSymbol.document_currency_code).toBe("EUR");
    expect(normalizedSymbol.tax_currency_code).toBe("EUR");
  });

  it("should correctly resolve tax_currency_code from fallback when tax_currency is text", () => {
    const payload = {
      business_id: "test-biz",
      document_currency_code: "USD",
      tax_currency: "US Dollar",
      invoice_line: [],
    };

    const normalized = normalizeInvoicePayload(payload as any);
    expect(normalized.document_currency_code).toBe("USD");
    expect(normalized.tax_currency_code).toBe("USD");
  });
});
