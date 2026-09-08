/**
 * Single source of truth for NRS invoice type codes.
 *
 * The document type is a property of the EVENT, not a static default: an
 * `erp.invoice.submitted` is a commercial invoice, an `erp.creditnote.issued`
 * is a credit note. Both the invoice payload (via the transform job) and the
 * ERP callback (via sync-erp) resolve through here so the code stamped on the
 * invoice and the code reported back to the ERP can never disagree.
 *
 * Codes are taken from the NRS documentation for
 * `GET base_url/api/v1/invoice/resources/invoice-types`:
 *
 * Key  Type    Value                   Description
 * 380  String  Credit Note             Credit Note
 * 381  String  Commercial Invoice      Commercial Invoice
 * 384  String  Debit Note              Debit Note
 * 385  String  Self Billed Invoice     Self Billed Invoice
 * 388  String  Factored Invoice        Factored Invoice
 * 389  String  Statement of Account    Statement of Account
 *
 * NRS does NOT follow UNCL1001 here: under UNCL1001, 380 is a commercial invoice
 * and 381 a credit note. NRS assigns them the other way round (380 = Credit Note,
 * 381 = Commercial Invoice). Do not "correct" these against the international
 * standard — they are correct as documented by FIRS/NRS.
 */

export const InvoiceTypeCode = {
  CREDIT_NOTE: "380",
  COMMERCIAL_INVOICE: "381",
  DEBIT_NOTE: "384",
  SELF_BILLED_INVOICE: "385",
  FACTORED_INVOICE: "388",
  STATEMENT_OF_ACCOUNT: "389",
} as const;

export type InvoiceTypeCodeValue =
  (typeof InvoiceTypeCode)[keyof typeof InvoiceTypeCode];

export const VALID_INVOICE_TYPE_CODES = new Set<string>(
  Object.values(InvoiceTypeCode),
);

/** Human-readable names, as documented by NRS. */
export const INVOICE_TYPE_LABELS: Record<string, string> = {
  [InvoiceTypeCode.CREDIT_NOTE]: "Credit Note",
  [InvoiceTypeCode.COMMERCIAL_INVOICE]: "Commercial Invoice",
  [InvoiceTypeCode.DEBIT_NOTE]: "Debit Note",
  [InvoiceTypeCode.SELF_BILLED_INVOICE]: "Self Billed Invoice",
  [InvoiceTypeCode.FACTORED_INVOICE]: "Factored Invoice",
  [InvoiceTypeCode.STATEMENT_OF_ACCOUNT]: "Statement of Account",
};

/** Fallback when an event carries no recognisable document type. */
export const DEFAULT_INVOICE_TYPE_CODE = InvoiceTypeCode.COMMERCIAL_INVOICE;

/**
 * Text/Label/Alias -> NRS Invoice Type Code
 */
const INVOICE_TYPE_ALIASES: Array<{ match: RegExp; code: string }> = [
  {
    match: /credit[\s._-]?note|creditnote|^cn$/i,
    code: InvoiceTypeCode.CREDIT_NOTE,
  },
  {
    match: /debit[\s._-]?note|debitnote|^dn$/i,
    code: InvoiceTypeCode.DEBIT_NOTE,
  },
  {
    match: /self[\s._-]?bill(ed)?(\s*invoice)?/i,
    code: InvoiceTypeCode.SELF_BILLED_INVOICE,
  },
  {
    match: /factor(ed)?(\s*invoice)?/i,
    code: InvoiceTypeCode.FACTORED_INVOICE,
  },
  {
    match: /statement(\s*of\s*account)?/i,
    code: InvoiceTypeCode.STATEMENT_OF_ACCOUNT,
  },
  {
    match: /commercial[\s._-]?invoice|tax[\s._-]?invoice|^invoice$/i,
    code: InvoiceTypeCode.COMMERCIAL_INVOICE,
  },
];

/**
 * Event type -> document type. Matched on the normalised event string, so
 * `erp.creditnote.issued`, `creditnote.issued` and `invoice.creditnote` all
 * resolve the same way. Order matters: the first match wins, so the more
 * specific document types are listed before the generic invoice.
 */
const EVENT_TYPE_RULES: Array<{ match: RegExp; code: string }> = [
  {
    match: /creditnote|credit_note|credit\.note|credit-note/,
    code: InvoiceTypeCode.CREDIT_NOTE,
  },
  {
    match: /debitnote|debit_note|debit\.note|debit-note/,
    code: InvoiceTypeCode.DEBIT_NOTE,
  },
  {
    match: /selfbill|self_bill|self-bill/,
    code: InvoiceTypeCode.SELF_BILLED_INVOICE,
  },
  { match: /factor/, code: InvoiceTypeCode.FACTORED_INVOICE },
  { match: /statement/, code: InvoiceTypeCode.STATEMENT_OF_ACCOUNT },
  { match: /invoice/, code: InvoiceTypeCode.COMMERCIAL_INVOICE },
];

/**
 * Resolves the document type code (e.g. "380", "381", "384") from event type,
 * explicit code, and/or invoice kind.
 *
 * If the event or kind indicates a specific document type (e.g. credit note or debit note),
 * that document type takes precedence to avoid UNCL1001 / NRS code confusion.
 */
export function resolveInvoiceTypeFromEvent(
  eventType?: unknown,
  explicitCode?: unknown,
  invoiceKind?: unknown,
): string {
  const normExplicit = String(explicitCode ?? "").trim();
  const normEvent = String(eventType ?? "").toLowerCase().trim();
  const normKind = String(invoiceKind ?? "").toLowerCase().trim();

  // 1. Check explicitCode if provided
  if (normExplicit) {
    if (VALID_INVOICE_TYPE_CODES.has(normExplicit)) {
      return normExplicit;
    }

    for (const alias of INVOICE_TYPE_ALIASES) {
      if (alias.match.test(normExplicit)) {
        return alias.code;
      }
    }

    return normExplicit;
  }

  // 2. Check if event clearly specifies document type
  for (const rule of EVENT_TYPE_RULES) {
    if (rule.match.test(normEvent)) {
      return rule.code;
    }
  }

  // 3. Check if invoice_kind was misused as document type (e.g. "Credit Note", "CN", "Debit Note")
  if (normKind) {
    for (const alias of INVOICE_TYPE_ALIASES) {
      if (alias.match.test(normKind)) {
        return alias.code;
      }
    }
  }

  return DEFAULT_INVOICE_TYPE_CODE;
}

