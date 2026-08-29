import { generateRandomString } from "../../../../@lib";

export function generateDatestamp(date: Date = new Date()): string {
  const resolvedDate = new Date(date);
  const y = resolvedDate.getFullYear();
  const m = String(resolvedDate.getMonth() + 1).padStart(2, "0");
  const d = String(resolvedDate.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function generateInvoiceRef(date: Date = new Date(), ref?: string): string {
  const randomSuffix = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");

  if (ref && ref.trim() !== "") {
    return `${ref.trim()}${randomSuffix}`;
  } else {
    const formattedDate = date.toISOString().slice(0, 10).replace(/-/g, "");
    return `INV${formattedDate}${randomSuffix}`;
  }
}

export function sanitizeIRN(irn: string): string {
  if (typeof irn !== "string") {
    return irn;
  }

  return irn
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
}

export function sanitizeInvoiceIRNs(invoice: Record<string, unknown> | null | undefined): void {
  if (!invoice || typeof invoice !== "object") {
    return;
  }

  if (typeof invoice.irn === "string" && invoice.irn.trim() !== "") {
    invoice.irn = sanitizeIRN(invoice.irn);
  }

  const adjustmentCodes = ["380", "383", "384", "385", "386", "393", "395"];
  const invoiceTypeCode = String(invoice.invoice_type_code || "");
  const isAdjustmentNote = adjustmentCodes.includes(invoiceTypeCode);

  if (isAdjustmentNote) {
    if (!Array.isArray(invoice.billing_reference) || invoice.billing_reference.length === 0) {
      const defaultRef = typeof invoice.irn === "string" ? invoice.irn : "";
      let defaultDate = "";
      if (typeof invoice.issue_date === "string" && invoice.issue_date.trim() !== "") {
        defaultDate = invoice.issue_date.trim();
      } else {
        defaultDate = new Date().toISOString().split("T")[0];
      }

      invoice.billing_reference = [
        { irn: sanitizeIRN(defaultRef), issue_date: defaultDate },
      ];
    }
  }

  if (Array.isArray(invoice.billing_reference)) {
    for (const ref of invoice.billing_reference) {
      if (ref && typeof ref === "object" && typeof (ref as Record<string, unknown>).irn === "string") {
        (ref as Record<string, unknown>).irn = sanitizeIRN((ref as Record<string, unknown>).irn as string);
      }
    }
  }

  const singleRefKeys = [
    "dispatch_document_reference",
    "receipt_document_reference",
    "originator_document_reference",
    "contract_document_reference",
  ];

  for (const refKey of singleRefKeys) {
    const docRef = invoice[refKey] as Record<string, unknown> | undefined;
    if (docRef && typeof docRef === "object" && typeof docRef.irn === "string") {
      docRef.irn = sanitizeIRN(docRef.irn);
    }
  }

  if (Array.isArray(invoice.additional_document_reference)) {
    for (const ref of invoice.additional_document_reference) {
      if (ref && typeof ref === "object" && typeof (ref as Record<string, unknown>).irn === "string") {
        (ref as Record<string, unknown>).irn = sanitizeIRN((ref as Record<string, unknown>).irn as string);
      }
    }
  }
}

export function generateIRN(
  invoiceNumber: string,
  serviceId: string | undefined,
  date: Date = new Date(),
): string | undefined {
  let finalServiceId = serviceId;
  let baseRef = invoiceNumber;

  if (invoiceNumber && typeof invoiceNumber === "string") {
    const match = invoiceNumber
      .trim()
      .match(/^([A-Z0-9]+)-([A-Z0-9]{8})-([0-9]{8})$/i);
    if (match) {
      if (!finalServiceId) {
        finalServiceId = match[2];
      }
      baseRef = match[1];
    }
  }

  if (!finalServiceId) {
    return undefined;
  }

  const padding = generateRandomString(4).substring(0, 4).toUpperCase();
  const inv = (baseRef + padding).replace(/[^A-Za-z0-9]/g, "");
  if (!/^[A-Za-z0-9]+$/.test(inv)) {
    return undefined;
  }

  const datestamp = generateDatestamp(date);
  return `${inv}-${finalServiceId}-${datestamp}`.toUpperCase();
}
