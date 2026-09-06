/**
 * Single source of truth for FIRS invoice type codes.
 *
 * The document type is a property of the EVENT, not a static default: an
 * `erp.invoice.submitted` is a commercial invoice, an `erp.creditnote.issued`
 * is a credit note. Both the invoice payload (via the transform job) and the
 * ERP callback (via sync-erp) resolve through here so the code stamped on the
 * invoice and the code reported back to the ERP can never disagree.
 *
 * Codes follow UNCL1001, the list PEPPOL/UBL draws on and which NRS models its
 * e-invoicing on. Verified against the standard: 380 commercial invoice, 381
 * credit note, 383 debit note, 384 corrected invoice. If NRS's own
 * `invoice-types` resource turns out to disagree, change the constants here
 * and every path follows.
 *
 * Note that 384 is a CORRECTED invoice, not a debit note — a distinction the
 * previous hardcoded list in the document-types endpoint got wrong.
 */

export const InvoiceTypeCode = {
  COMMERCIAL_INVOICE: "380",
  CREDIT_NOTE: "381",
  DEBIT_NOTE: "383",
  CORRECTED_INVOICE: "384",
  CONSOLIDATED_INVOICE: "385",
  PREPAYMENT_INVOICE: "386",
  SELF_BILLED_INVOICE: "389",
  FACTORED_INVOICE: "393",
  CONSIGNMENT_INVOICE: "395",
} as const;

/** Human-readable names, for the /document-types reference endpoint. */
export const INVOICE_TYPE_LABELS: Record<string, string> = {
  [InvoiceTypeCode.COMMERCIAL_INVOICE]: "Commercial Invoice",
  [InvoiceTypeCode.CREDIT_NOTE]: "Credit Note",
  [InvoiceTypeCode.DEBIT_NOTE]: "Debit Note",
  [InvoiceTypeCode.CORRECTED_INVOICE]: "Corrected Invoice",
  [InvoiceTypeCode.CONSOLIDATED_INVOICE]: "Consolidated Invoice",
  [InvoiceTypeCode.PREPAYMENT_INVOICE]: "Prepayment Invoice",
  [InvoiceTypeCode.SELF_BILLED_INVOICE]: "Self-billed Invoice",
  [InvoiceTypeCode.FACTORED_INVOICE]: "Factored Invoice",
  [InvoiceTypeCode.CONSIGNMENT_INVOICE]: "Consignment Invoice",
};

/** Fallback when an event carries no recognisable document type. */
export const DEFAULT_INVOICE_TYPE_CODE = InvoiceTypeCode.COMMERCIAL_INVOICE;

/**
 * Event type → document type. Matched on the normalised event string, so
 * `erp.creditnote.issued`, `creditnote.issued` and `invoice.creditnote` all
 * resolve the same way. Order matters: the first match wins, so the more
 * specific document types are listed before the generic invoice.
 */
const EVENT_TYPE_RULES: Array<{ match: RegExp; code: string }> = [
  { match: /creditnote|credit_note|credit\.note/, code: InvoiceTypeCode.CREDIT_NOTE },
  { match: /debitnote|debit_note|debit\.note/, code: InvoiceTypeCode.DEBIT_NOTE },
  { match: /selfbill|self_bill/, code: InvoiceTypeCode.SELF_BILLED_INVOICE },
  { match: /prepayment/, code: InvoiceTypeCode.PREPAYMENT_INVOICE },
  { match: /consignment/, code: InvoiceTypeCode.CONSIGNMENT_INVOICE },
  { match: /factor/, code: InvoiceTypeCode.FACTORED_INVOICE },
  { match: /correct/, code: InvoiceTypeCode.CORRECTED_INVOICE },
  { match: /invoice/, code: InvoiceTypeCode.COMMERCIAL_INVOICE },
];

/**
 * Resolves the document type for an event.
 *
 * An explicit code always wins — a source system that states its own document
 * type is more authoritative than anything inferred from the event name.
 */
export function resolveInvoiceTypeFromEvent(
  eventType?: string,
  explicitCode?: string,
): string {
  if (typeof explicitCode === "string" && explicitCode.trim() !== "") {
    return explicitCode.trim();
  }

  const normalised = String(eventType ?? "").toLowerCase();
  for (const rule of EVENT_TYPE_RULES) {
    if (rule.match.test(normalised)) return rule.code;
  }

  return DEFAULT_INVOICE_TYPE_CODE;
}
