import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sanitizeInvoicePayload } from "../src/v1/workflow/utils/invoice-sanitizer.util";
import { FIRSInvoiceTransformerV2 } from "../src/v1/workflow/utils/transformer/v2";
import { FIRSInvoiceSchema } from "../src/v1/workflow/utils/transformer/schema-validator";
import { aiConfig } from "../src/@config/ai";

/** Fields FIRS rejects the request without. */
const FIRS_REQUIRED = [
  "irn",
  "business_id",
  "tax_currency_code",
  "document_currency_code",
  "invoice_type_code",
  "invoice_line",
  "accounting_supplier_party",
  "accounting_customer_party",
  "legal_monetary_total",
];

const expectFirsComplete = (payload: Record<string, any>) => {
  for (const key of FIRS_REQUIRED) {
    expect(
      payload[key] === undefined || payload[key] === "" ? `MISSING:${key}` : key,
    ).toBe(key);
  }
};

describe("sanitizeInvoicePayload — envelope handling", () => {
  const firsInvoice = () => ({
    irn: "8754310000010306009B29E-DE838B45-20260904",
    business_id: "BIZ",
    tax_currency_code: "NGN",
    document_currency_code: "NGN",
    invoice_type_code: "380",
    invoice_kind: "B2B",
    invoice_line: [{ item: { name: "Access Point" }, line_extension_amount: 1 }],
    accounting_supplier_party: { party_name: "DD", tin: "00364075-0001" },
    accounting_customer_party: { party_name: "Test Company", tin: "00364075-0001" },
    legal_monetary_total: { payable_amount: 1.08 },
    payment_status: "PENDING",
  });

  it("keeps every FIRS field when a leftover envelope key is present", () => {
    // Regression: the transformer built its result as { ...sourcePayload,
    // ...mapped }, so an ERP body shaped { invoice: {...} } left an `invoice`
    // key behind. The sanitizer unwrapped to it and shipped the raw ERP object,
    // which FIRS rejected with "taxcurrencycode is required".
    const withEnvelope = {
      ...firsInvoice(),
      invoice: { cf_tin: "00364075-0001", customer_name: "Test Company" },
    };
    const out: any = sanitizeInvoicePayload(withEnvelope);

    expect(out.tax_currency_code).toBe("NGN");
    expect(Array.isArray(out.invoice_line)).toBe(true);
    expectFirsComplete(out);
  });

  it("strips the envelope wrapper so the raw ERP object is not sent on", () => {
    const out: any = sanitizeInvoicePayload({
      ...firsInvoice(),
      invoice: { cf_tin: "1" },
      data: { other: true },
    });
    expect(out.invoice).toBeUndefined();
    expect(out.data).toBeUndefined();
  });

  it("still unwraps a genuine envelope", () => {
    const out: any = sanitizeInvoicePayload({
      invoice: { irn: "X", tax_currency_code: "USD", customer_name: "C" },
    });
    expect(out.irn).toBe("X");
    expect(out.tax_currency_code).toBe("USD");
  });

  it("still unwraps a { data } envelope", () => {
    const out: any = sanitizeInvoicePayload({
      data: { irn: "D1", tax_currency_code: "EUR" },
    });
    expect(out.irn).toBe("D1");
  });
});

describe("sanitizeInvoicePayload — tax_currency_code is always present", () => {
  it("falls back to the document currency", () => {
    const out: any = sanitizeInvoicePayload({ irn: "Y", document_currency_code: "USD" });
    expect(out.tax_currency_code).toBe("USD");
  });

  it("falls back to NGN when neither is supplied", () => {
    expect((sanitizeInvoicePayload({ irn: "Z" }) as any).tax_currency_code).toBe("NGN");
  });

  it("normalises a supplied value", () => {
    const out: any = sanitizeInvoicePayload({ irn: "A", tax_currency_code: " ngn " });
    expect(out.tax_currency_code).toBe("NGN");
  });

  it("replaces a blank value", () => {
    const out: any = sanitizeInvoicePayload({ irn: "B", tax_currency_code: "   " });
    expect(out.tax_currency_code).toBe("NGN");
  });
});

describe("retry-from-step replays a stored transform successfully", () => {
  it("accepts a transform stored by the old code, envelope key and all", () => {
    // retry-from-step feeds metadata.transformedInvoice straight back in, so
    // invoices already in the database still carry the old shape.
    const stored = {
      irn: "8754310000010306009B29E-DE838B45-20260904",
      business_id: "BIZ",
      document_currency_code: "NGN",
      tax_currency_code: "NGN",
      invoice_type_code: "380",
      invoice_line: [{ item: { name: "Access Point" }, line_extension_amount: 1 }],
      accounting_supplier_party: { party_name: "DD", tin: "00364075-0001" },
      accounting_customer_party: { party_name: "Test Co", tin: "00364075-0001" },
      legal_monetary_total: { payable_amount: 1.08 },
      invoice: { cf_tin: "00364075-0001", line_items: [] },
    };
    const out: any = sanitizeInvoicePayload({ ...stored, tenant_id: "t" });
    expectFirsComplete(out);
    expect(out.invoice).toBeUndefined();
  });
});

describe("failsafe: no LLM available", () => {
  let saved: { enabled: boolean; openaiEnabled: boolean } | undefined;

  beforeAll(() => {
    if (aiConfig) {
      saved = { enabled: aiConfig.enabled, openaiEnabled: (aiConfig as any).openaiEnabled };
      aiConfig.enabled = false;
      (aiConfig as any).openaiEnabled = false;
    }
  });

  afterAll(() => {
    if (aiConfig && saved) {
      aiConfig.enabled = saved.enabled;
      (aiConfig as any).openaiEnabled = saved.openaiEnabled;
    }
  });

  it("produces a FIRS-complete payload from a Zoho envelope with zero LLM calls", async () => {
    const zohoWebhookBody = {
      invoice: {
        invoice_number: "DDL-INV-860",
        customer_name: "Test Company",
        cf_tin: "00364075-0001",
        currency_code: "NGN",
        sub_total: 1,
        tax_total: 0.08,
        total: 1.08,
        date: "2026-09-04T00:00:00.000Z",
        custom_field_hash: { cf_tax_currency_code: "NGN", cf_invoice_kind: "B2B" },
        line_items: [
          { name: "Access Point", quantity: 1, rate: 1, item_total: 1, tax_percentage: 7.5 },
        ],
      },
    };

    const transformer = new FIRSInvoiceTransformerV2(
      "fake_key",
      "http://localhost",
      "openai",
      "gpt-4o-mini",
    );
    const res: any = await transformer.transformInvoice(
      zohoWebhookBody as any,
      { tenantId: "t", businessId: "BIZ", businessTIN: "00364075-0001", businessName: "DD" } as any,
      [],
      [],
      [],
      FIRSInvoiceSchema,
    );

    expect(res.success).toBe(true);

    // The envelope key must not survive into the FIRS payload.
    expect(res.data.invoice).toBeUndefined();
    expect(res.data.tax_currency_code).toBeTruthy();

    // And it must still be complete after sanitisation, which is what actually
    // goes over the wire to FIRS.
    const sent: any = sanitizeInvoicePayload({ ...res.data, tenant_id: "t" });
    expect(sent.tax_currency_code).toBe("NGN");
    expect(sent.invoice).toBeUndefined();
    expectFirsComplete(sent);
  });
});
