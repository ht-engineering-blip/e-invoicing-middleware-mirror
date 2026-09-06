import { describe, expect, it } from "bun:test";
import {
  resolveInvoiceTypeFromEvent,
  InvoiceTypeCode,
} from "../src/v1/workflow/utils/invoice-type";
import { resolveInvoiceTypeCode } from "../src/v1/workflow/jobs/definitions/sync-erp.job";

/** The real NRS invoice-types list. */
const LIST: any[] = [
  { code: "380", value: "Credit Note" },
  { code: "381", value: "Commercial Invoice" },
  { code: "384", value: "Debit Note" },
  { code: "385", value: "Self Billed Invoice" },
];

describe("document type follows the event", () => {
  it("maps an invoice event to a commercial invoice", () => {
    // NRS assigns 381 to Commercial Invoice — the opposite of UNCL1001.
    expect(resolveInvoiceTypeFromEvent("erp.invoice.submitted")).toBe(
      InvoiceTypeCode.COMMERCIAL_INVOICE,
    );
    expect(resolveInvoiceTypeFromEvent("invoice.submitted")).toBe("381");
  });

  it("maps a credit note event to a credit note", () => {
    expect(resolveInvoiceTypeFromEvent("erp.creditnote.issued")).toBe(
      InvoiceTypeCode.CREDIT_NOTE,
    );
    expect(resolveInvoiceTypeFromEvent("credit_note.issued")).toBe("380");
  });

  it("keeps invoices and credit notes distinguishable", () => {
    // The ERP router branches on this value, so the two must never collide.
    expect(resolveInvoiceTypeFromEvent("erp.invoice.submitted")).not.toBe(
      resolveInvoiceTypeFromEvent("erp.creditnote.issued"),
    );
  });

  it("maps a debit note event", () => {
    expect(resolveInvoiceTypeFromEvent("erp.debitnote.issued")).toBe("384");
  });

  it("uses the NRS codes, not UNCL1001", () => {
    // Documented at GET /api/v1/invoice/resources/invoice-types. Under
    // UNCL1001 these two are reversed; NRS is authoritative here.
    expect(InvoiceTypeCode.COMMERCIAL_INVOICE).toBe("381");
    expect(InvoiceTypeCode.CREDIT_NOTE).toBe("380");
    expect(InvoiceTypeCode.DEBIT_NOTE).toBe("384");
    expect(InvoiceTypeCode.SELF_BILLED_INVOICE).toBe("385");
    expect(InvoiceTypeCode.FACTORED_INVOICE).toBe("388");
    expect(InvoiceTypeCode.STATEMENT_OF_ACCOUNT).toBe("389");
  });

  it("defaults an unrecognised event to a commercial invoice", () => {
    expect(resolveInvoiceTypeFromEvent("something.unexpected")).toBe("381");
    expect(resolveInvoiceTypeFromEvent(undefined)).toBe("381");
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
    expect(resolveInvoiceTypeCode("erp.creditnote.issued", LIST)).toBe("380");
    expect(resolveInvoiceTypeCode("erp.invoice.submitted", LIST)).toBe("381");
  });
});
