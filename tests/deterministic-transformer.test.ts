import { describe, expect, it } from "bun:test";
import { DeterministicCompleter } from "../src/v1/workflow/utils/transformer/deterministic-completer";
import { TransformerCircuitBreaker } from "../src/v1/workflow/utils/transformer/circuit-breaker";
import { FIRSInvoiceTransformerV2 } from "../src/v1/workflow/utils/transformer/v2";
import { FIRSInvoiceSchema } from "../src/v1/workflow/utils/transformer/schema-validator";

describe("Fail-Proof Deterministic Transformer & Circuit Breaker Tests", () => {
  it("should auto-complete missing fields and self-heal mathematical totals without LLM", () => {
    const rawInvoice = {
      invoice_reference: "INV-2026-001",
      customer_name: "Acme Nigeria Ltd",
      customer_tin: "12345678-0001",
      items: [
        {
          name: "Widget Pro",
          description: "High quality widget",
          quantity: 10,
          unit_price: 5000,
        },
        {
          name: "Consulting Service",
          quantity: 2,
          unit_price: 15000,
        },
      ],
    };

    const authContext = {
      tenantId: "tenant_acme_001",
      businessId: "BIZ_ACME_001",
      businessTIN: "98765432-0001",
      businessName: "Acme Supplier Inc",
      serviceId: "34A843BE",
    };

    const result = DeterministicCompleter.reconcileAndComplete(rawInvoice, authContext as any);

    expect(result.isFullyCompliant).toBe(true);
    expect(result.completedData.business_id).toBe("BIZ_ACME_001");
    expect(result.completedData.accounting_supplier_party.tin).toBe("98765432-0001");
    expect(result.completedData.accounting_customer_party.name).toBe("Acme Nigeria Ltd");
    expect(result.completedData.accounting_customer_party.tin).toBe("12345678-0001");

    // Verify mathematical self-healing
    // Item 1: 10 * 5000 = 50,000
    // Item 2: 2 * 15,000 = 30,000
    // Total Line Extension = 80,000
    const lmt = result.completedData.legal_monetary_total;
    expect(lmt.line_extension_amount).toBe(80000);
    expect(lmt.tax_exclusive_amount).toBe(80000);

    // Default VAT 7.5% = 6,000
    expect(lmt.tax_inclusive_amount).toBe(86000);
    expect(lmt.payable_amount).toBe(86000);

    expect(result.completedData.invoice_line.length).toBe(2);
    expect(result.completedData.invoice_line[0].price.price_unit).toBe("H87");
  });

  it("should trip circuit breaker on LLM rate limit (429) and recover", () => {
    const circuitBreaker = TransformerCircuitBreaker.getInstance();
    circuitBreaker.reset();

    expect(circuitBreaker.canExecute()).toBe(true);

    // Simulate 429 Rate Limit
    circuitBreaker.recordFailure(new Error("429 Too Many Requests: Rate limit exceeded"));

    expect(circuitBreaker.getState()).toBe("OPEN");
    expect(circuitBreaker.canExecute()).toBe(false);

    // Reset circuit breaker
    circuitBreaker.reset();
    expect(circuitBreaker.canExecute()).toBe(true);
  });

  it("should transform mapped ERP payload with 0 LLM calls", async () => {
    const transformer = new FIRSInvoiceTransformerV2("fake_key", "http://localhost", "openai", "gpt-4o-mini");

    const erpInvoice = {
      invoiceNumber: "INV-9999",
      customer_name: "Global Tech Ltd",
      customer_tin: "11223344-0001",
      invoice_line: [
        {
          description: "Cloud Hosting Services",
          quantity: 1,
          price: 100000,
        },
      ],
    };

    const authContext = {
      tenantId: "tenant_global_001",
      businessId: "BIZ_GLOBAL",
      businessTIN: "55667788-0001",
      businessName: "Global Hosting Nigeria",
    };

    const res = await transformer.transformInvoice(
      erpInvoice,
      authContext as any,
      [],
      [],
      [],
      FIRSInvoiceSchema,
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.business_id).toBe("BIZ_GLOBAL");
      expect((res.data.accounting_customer_party as any).name).toBe("Global Tech Ltd");
      expect((res.data.invoice_line as any[])[0].item.name).toBe("Cloud Hosting Services");
    }
  });
});
