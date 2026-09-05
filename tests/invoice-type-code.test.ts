import { describe, expect, it } from "bun:test";
import { sanitizeInvoicePayload } from "../src/v1/workflow/utils/invoice-sanitizer.util";
import { DeterministicCompleter } from "../src/v1/workflow/utils/transformer/deterministic-completer";

const auth: any = { tenantId: "t", businessId: "BIZ", businessTIN: "00364075-0001" };

describe("invoice_type_code", () => {
  it("defaults a standard invoice to 380, not 396", () => {
    // 380 = Commercial Invoice (UNCL1001/UBL). 396 is "Invoice Request", which
    // sent every ordinary sales invoice down the wrong branch of the ERP
    // callback router.
    const res = DeterministicCompleter.reconcileAndComplete({} as any, auth, [], []);
    expect((res.completedData as any).invoice_type_code).toBe("380");
  });

  it("keeps an explicitly mapped code", () => {
    const res = DeterministicCompleter.reconcileAndComplete(
      { invoice_type_code: "381" } as any,
      auth,
      [],
      [],
    );
    expect((res.completedData as any).invoice_type_code).toBe("381");
  });

  it("is not overwritten by the sanitizer", () => {
    expect((sanitizeInvoicePayload({ irn: "X", invoice_type_code: "381" }) as any).invoice_type_code).toBe("381");
    expect((sanitizeInvoicePayload({ irn: "X", invoice_type_code: "383" }) as any).invoice_type_code).toBe("383");
  });

  it("falls back to 380 when the sanitizer sees no code", () => {
    expect((sanitizeInvoicePayload({ irn: "X" }) as any).invoice_type_code).toBe("380");
  });
});
