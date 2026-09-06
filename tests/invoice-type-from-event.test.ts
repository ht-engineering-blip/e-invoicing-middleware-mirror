import { describe, expect, it } from "bun:test";
import {
  resolveInvoiceTypeFromEvent,
  InvoiceTypeCode,
  INVOICE_TYPE_LABELS,
} from "../src/v1/workflow/utils/invoice-type";
import { resolveInvoiceTypeCode } from "../src/v1/workflow/jobs/definitions/sync-erp.job";

/** FIRS list as the codebase's /document-types endpoint describes it. */
const LIST: any[] = [
  { code: "380", value: "Credit Note" },
  { code: "381", value: "Commercial Invoice" },
  { code: "384", value: "Debit Note" },
  { code: "396", value: "Invoice Request" },
];

describe("document type follows the event", () => {
  it("maps an invoice event to a commercial invoice", () => {
    expect(resolveInvoiceTypeFromEvent("erp.invoice.submitted")).toBe(
      InvoiceTypeCode.COMMERCIAL_INVOICE,
    );
    expect(resolveInvoiceTypeFromEvent("invoice.submitted")).toBe("380");
  });

  it("maps a credit note event to a credit note", () => {
    expect(resolveInvoiceTypeFromEvent("erp.creditnote.issued")).toBe(
      InvoiceTypeCode.CREDIT_NOTE,
    );
    expect(resolveInvoiceTypeFromEvent("credit_note.issued")).toBe("381");
  });

  it("keeps invoices and credit notes distinguishable", () => {
    // The ERP router branches on this value, so the two must never collide.
    expect(resolveInvoiceTypeFromEvent("erp.invoice.submitted")).not.toBe(
      resolveInvoiceTypeFromEvent("erp.creditnote.issued"),
    );
  });

  it("maps a debit note event to 383, not 384", () => {
    // UNCL1001: 383 is Debit note; 384 is Corrected invoice. The old
    // document-types list conflated the two.
    expect(resolveInvoiceTypeFromEvent("erp.debitnote.issued")).toBe("383");
    expect(InvoiceTypeCode.DEBIT_NOTE).toBe("383");
    expect(InvoiceTypeCode.CORRECTED_INVOICE).toBe("384");
  });

  it("uses UNCL1001 codes throughout", () => {
    expect(InvoiceTypeCode.COMMERCIAL_INVOICE).toBe("380");
    expect(InvoiceTypeCode.CREDIT_NOTE).toBe("381");
    expect(InvoiceTypeCode.SELF_BILLED_INVOICE).toBe("389");
    expect(InvoiceTypeCode.FACTORED_INVOICE).toBe("393");
  });

  it("defaults an unrecognised event to a commercial invoice", () => {
    expect(resolveInvoiceTypeFromEvent("something.unexpected")).toBe("380");
    expect(resolveInvoiceTypeFromEvent(undefined)).toBe("380");
  });

  it("lets an explicit code win over the event", () => {
    expect(resolveInvoiceTypeFromEvent("erp.creditnote.issued", "396")).toBe("396");
  });
});

describe("the ERP callback agrees with the invoice", () => {
  const events = [
    "erp.invoice.submitted",
    "invoice.submitted",
    "erp.creditnote.issued",
    "erp.debitnote.issued",
    "erp.selfbill.issued",
    "unknown.event",
  ];

  it("resolves identically with the FIRS list present", () => {
    for (const ev of events) {
      expect(resolveInvoiceTypeCode(ev, LIST)).toBe(resolveInvoiceTypeFromEvent(ev));
    }
  });

  it("resolves identically when the FIRS list is unavailable", () => {
    // The invoice-types fetch has an 800ms timeout and returns [] on failure,
    // so the empty-list path is a normal runtime case.
    for (const ev of events) {
      expect(resolveInvoiceTypeCode(ev, [])).toBe(resolveInvoiceTypeFromEvent(ev));
    }
  });

  it("no longer lets a fuzzy list match override the event", () => {
    // The list above claims 380 = Credit Note. That must not pull a credit
    // note event onto the same code a commercial invoice uses.
    expect(resolveInvoiceTypeCode("erp.creditnote.issued", LIST)).toBe("381");
    expect(resolveInvoiceTypeCode("erp.invoice.submitted", LIST)).toBe("380");
  });
});

describe("the /document-types reference list", () => {
  it("is derived from the same constants the pipeline stamps", () => {
    for (const code of Object.values(InvoiceTypeCode)) {
      expect(INVOICE_TYPE_LABELS[code]).toBeTruthy();
    }
  });

  it("no longer inverts commercial invoice and credit note", () => {
    expect(INVOICE_TYPE_LABELS["380"]).toBe("Commercial Invoice");
    expect(INVOICE_TYPE_LABELS["381"]).toBe("Credit Note");
    expect(INVOICE_TYPE_LABELS["383"]).toBe("Debit Note");
    expect(INVOICE_TYPE_LABELS["384"]).toBe("Corrected Invoice");
  });

  it("no longer advertises 396 as an invoice type", () => {
    expect(INVOICE_TYPE_LABELS["396"]).toBeUndefined();
  });
});
