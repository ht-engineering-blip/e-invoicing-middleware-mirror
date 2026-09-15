/**
 * Utility functions to extract invoiceNumber and customerName
 * across various ERP payloads, transformed FIRS schemas, and database documents.
 */

const INVOICE_NUMBER_PATHS = [
  "invoiceNumber",
  "invoice_number",
  "invoice_reference",
  "metadata.invoiceNumber",
  "metadata.InvoiceNumber",
  "metadata.invoice_number",
  "metadata.transformedInvoice.invoice_number",
  "metadata.transformedInvoice.invoice_reference",
  "metadata.transformedInvoice.invoiceNumber",
  "metadata.originalPayload.invoice_number",
  "metadata.originalPayload.invoiceNumber",
  "metadata.originalPayload.InvoiceNumber",
  "metadata.originalPayload.invoice.invoice_number",
  "metadata.originalPayload.invoice.invoiceNumber",
  "invoice.invoiceNumber",
  "invoice.invoice_number",
  "invoice.invoice_reference",
  "invoice.invoice.invoiceNumber",
  "originalPayload.invoice_number",
  "originalPayload.invoiceNumber",
  "originalPayload.InvoiceNumber",
  "originalPayload.invoice.invoice_number",
  "originalPayload.invoice.invoiceNumber",
  "erpInvoiceId",
];

const CUSTOMER_NAME_PATHS = [
  "customerName",
  "customer_name",
  "accounting_customer_party.party_name",
  "AccountingCustomerParty.Party.PartyName.0.Name",
  "metadata.customerName",
  "metadata.customer_name",
  "metadata.AccountingCustomerParty.Party.PartyName.0.Name",
  "metadata.accounting_customer_party.party_name",
  "metadata.transformedInvoice.accounting_customer_party.party_name",
  "metadata.transformedInvoice.customerName",
  "metadata.transformedInvoice.customer_name",
  "metadata.originalPayload.customer_name",
  "metadata.originalPayload.customerName",
  "metadata.originalPayload.customer.customer_name",
  "metadata.originalPayload.invoice.customer_name",
  "originalPayload.customer_name",
  "originalPayload.customerName",
  "originalPayload.customer.customer_name",
  "originalPayload.invoice.customer_name",
  "invoice.accounting_customer_party.party_name",
  "invoice.customerName",
  "invoice.customer_name",
];

function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let curr = obj;
  for (const part of parts) {
    if (curr == null) return undefined;
    curr = curr[part];
  }
  return curr;
}

/**
 * Extract invoice number from document or payload
 */
export function extractInvoiceNumber(doc: any, fallback?: any): string | undefined {
  if (!doc && !fallback) return undefined;

  for (const p of INVOICE_NUMBER_PATHS) {
    const val = getNestedValue(doc, p);
    if (typeof val === "string" && val.trim() !== "") {
      return val.trim();
    }
  }

  if (fallback) {
    for (const p of INVOICE_NUMBER_PATHS) {
      const val = getNestedValue(fallback, p);
      if (typeof val === "string" && val.trim() !== "") {
        return val.trim();
      }
    }
  }

  return undefined;
}

/**
 * Extract customer name from document or payload
 */
export function extractCustomerName(doc: any, fallback?: any): string | undefined {
  if (!doc && !fallback) return undefined;

  for (const p of CUSTOMER_NAME_PATHS) {
    const val = getNestedValue(doc, p);
    if (typeof val === "string" && val.trim() !== "") {
      return val.trim();
    }
  }

  if (fallback) {
    for (const p of CUSTOMER_NAME_PATHS) {
      const val = getNestedValue(fallback, p);
      if (typeof val === "string" && val.trim() !== "") {
        return val.trim();
      }
    }
  }

  return undefined;
}
