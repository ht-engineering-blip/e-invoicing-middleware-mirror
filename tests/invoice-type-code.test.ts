import { describe, expect, it } from "bun:test";
import { sanitizeInvoicePayload } from "../src/v1/workflow/utils/invoice-sanitizer.util";
import { DeterministicCompleter } from "../src/v1/workflow/utils/transformer/deterministic-completer";

const auth: any = { tenantId: "t", businessId: "BIZ", businessTIN: "00364075-0001" };

describe("invoice_type_code", () => {
  it("defaults a standard invoice to 381, not 396", () => {
    // 381 = Commercial Invoice per the NRS invoice-types resource. 396 is not
    // in that list at all, and sent every ordinary sales invoice down the
    // wrong branch of the ERP callback router.
    const res = DeterministicCompleter.reconcileAndComplete({} as any, auth, [], []);
    expect((res.completedData as any).invoice_type_code).toBe("381");
  });

  it("keeps an explicitly mapped code", () => {
    const res = DeterministicCompleter.reconcileAndComplete(
      { invoice_type_code: "380" } as any,
      auth,
      [],
      [],
    );
    expect((res.completedData as any).invoice_type_code).toBe("380");
  });

  it("is not overwritten by the sanitizer", () => {
    expect((sanitizeInvoicePayload({ irn: "X", invoice_type_code: "381" }) as any).invoice_type_code).toBe("381");
    expect((sanitizeInvoicePayload({ irn: "X", invoice_type_code: "383" }) as any).invoice_type_code).toBe("383");
  });

  it("falls back to a commercial invoice when the sanitizer sees no code", () => {
    // 381, not 380 — 380 is a Credit Note under the NRS code list.
    expect((sanitizeInvoicePayload({ irn: "X" }) as any).invoice_type_code).toBe("381");
  });
});
