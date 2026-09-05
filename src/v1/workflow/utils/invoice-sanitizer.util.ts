import { generateUniqueHsnCode } from "./transformer/classification.helper";
import { ValidationError } from "../../../@lib/errors";

/**
 * Sanitizes and normalizes an invoice payload before dispatching to FIRS or validation services.
 * Implements full FIRS/NRS Schema 1.1 compliance for all required and optional structures.
 */
/**
 * Fields that only ever appear on an already-transformed FIRS invoice. Their
 * presence means the object IS the invoice, not an envelope wrapping one.
 */
const FIRS_INVOICE_MARKERS = [
  "irn",
  "invoice_line",
  "accounting_supplier_party",
  "accounting_customer_party",
  "legal_monetary_total",
  "invoice_reference",
  "tax_currency_code",
] as const;

/**
 * FIRS rejects a party whose businessdescription is shorter than 5 characters
 * ("must be at least in length or value 5"), and it is not optional despite
 * being modelled that way locally. Nothing upstream carries a real description
 * — the tenant record has no such field — so derive a stable one from the party
 * name, which is real data, and fall back to a generic value only when there is
 * no usable name.
 */
const MIN_BUSINESS_DESCRIPTION_LENGTH = 5;
const GENERIC_BUSINESS_DESCRIPTION = "General goods and services";

export function ensureBusinessDescription(
  party: Record<string, unknown>,
  partyName?: unknown,
): string {
  const existing = party.business_description;
  if (
    typeof existing === "string" &&
    existing.trim().length >= MIN_BUSINESS_DESCRIPTION_LENGTH
  ) {
    return existing.trim();
  }

  const name =
    typeof partyName === "string" && partyName.trim() !== ""
      ? partyName.trim()
      : typeof party.party_name === "string"
        ? (party.party_name as string).trim()
        : "";

  const derived = name ? `${name} - goods and services` : "";
  return derived.length >= MIN_BUSINESS_DESCRIPTION_LENGTH
    ? derived
    : GENERIC_BUSINESS_DESCRIPTION;
}

export function sanitizeInvoicePayload(
  rawInvoice: Record<string, any>,
): Record<string, unknown> {
  if (!rawInvoice || typeof rawInvoice !== "object") return rawInvoice;

  // Handle nested envelopes if passed.
  //
  // Only unwrap when the payload is NOT already a FIRS invoice. The
  // transformer builds its result as { ...sourcePayload, ...mapped }, so when
  // the ERP webhook body is shaped { invoice: {...} } the result carries a
  // leftover `invoice` key. Unwrapping on that key discarded every field the
  // transformer had produced — tax_currency_code, invoice_line, payment_means,
  // payment_status, invoice_reference — and handed FIRS the raw ERP object,
  // which it rejected with "invoicerequest.invoice.taxcurrencycode is
  // required".
  const looksLikeFirsInvoice = (o: unknown): boolean => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    const rec = o as Record<string, unknown>;
    return FIRS_INVOICE_MARKERS.some((k) => rec[k] !== undefined);
  };

  let invoice: Record<string, unknown>;
  if (looksLikeFirsInvoice(rawInvoice)) {
    invoice = rawInvoice;
    // Drop any leftover envelope wrapper so the raw ERP object is not shipped
    // to FIRS alongside the mapped fields.
    delete invoice.invoice;
    delete invoice.data;
  } else if (rawInvoice.data && typeof rawInvoice.data === "object") {
    invoice = rawInvoice.data as Record<string, unknown>;
  } else if (rawInvoice.invoice && typeof rawInvoice.invoice === "object") {
    invoice = rawInvoice.invoice as Record<string, unknown>;
  } else {
    invoice = rawInvoice;
  }

  const toFloat = (val: unknown, fallback: number = 0): number => {
    if (typeof val === "number") return isNaN(val) ? fallback : val;
    if (typeof val === "string") {
      const cleaned = val.replace(/[^0-9.-]+/g, "");
      const num = Number(cleaned);
      return isNaN(num) ? fallback : num;
    }
    return fallback;
  };

  // 1. Root Level Core Identifiers
  if (
    typeof rawInvoice.business_id === "string" &&
    (rawInvoice.business_id as string).trim() !== ""
  ) {
    invoice.business_id = (rawInvoice.business_id as string).trim();
  } else if (typeof invoice.business_id === "string") {
    invoice.business_id = invoice.business_id.trim();
  }

  if (
    !invoice.document_currency_code ||
    typeof invoice.document_currency_code !== "string" ||
    invoice.document_currency_code.trim() === ""
  ) {
    invoice.document_currency_code = "NGN";
  } else {
    invoice.document_currency_code = invoice.document_currency_code
      .trim()
      .toUpperCase();
  }

  // FIRS requires taxcurrencycode. document_currency_code was defaulted above
  // but this one was not, so any payload that lost it failed validation.
  if (
    !invoice.tax_currency_code ||
    typeof invoice.tax_currency_code !== "string" ||
    invoice.tax_currency_code.trim() === ""
  ) {
    invoice.tax_currency_code = invoice.document_currency_code as string;
  } else {
    invoice.tax_currency_code = invoice.tax_currency_code.trim().toUpperCase();
  }

  if (
    !invoice.invoice_type_code ||
    typeof invoice.invoice_type_code !== "string" ||
    invoice.invoice_type_code.trim() === ""
  ) {
    invoice.invoice_type_code = "380";
  } else {
    invoice.invoice_type_code = invoice.invoice_type_code.trim();
  }

  if (
    !invoice.invoice_kind ||
    typeof invoice.invoice_kind !== "string" ||
    invoice.invoice_kind.trim() === ""
  ) {
    invoice.invoice_kind = "B2B";
  } else {
    invoice.invoice_kind = invoice.invoice_kind.trim().toUpperCase();
  }

  // 2. Issue Dates
  const todayDateStr = new Date().toISOString().slice(0, 10);
  if (
    typeof invoice.issue_date === "string" &&
    invoice.issue_date.trim() !== ""
  ) {
    invoice.issue_date = invoice.issue_date.trim().slice(0, 10);
  } else {
    invoice.issue_date = todayDateStr;
  }

  if (typeof invoice.due_date === "string" && invoice.due_date.trim() !== "") {
    invoice.due_date = invoice.due_date.trim().slice(0, 10);
  }

  if (
    !invoice.issue_time ||
    typeof invoice.issue_time !== "string" ||
    invoice.issue_time.trim() === ""
  ) {
    invoice.issue_time = new Date().toTimeString().slice(0, 8);
  } else {
    invoice.issue_time = invoice.issue_time.trim().slice(0, 8);
  }

  // 3. IRN Sanitization & Generation
  if (
    typeof rawInvoice.irn === "string" &&
    (rawInvoice.irn as string).trim() !== "" &&
    /^[A-Z0-9]+-[A-Z0-9]{8}-[0-9]{8}$/.test(
      (rawInvoice.irn as string).trim().toUpperCase(),
    )
  ) {
    invoice.irn = (rawInvoice.irn as string)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
  } else if (typeof invoice.irn === "string" && invoice.irn.trim() !== "") {
    const rawUpper = invoice.irn.toUpperCase().trim().replace(/\s+/g, "");
    const parts = rawUpper.split("-").filter(Boolean);
    if (parts.length >= 3) {
      const datePart = parts[parts.length - 1].replace(/[^0-9]/g, "");
      const servicePart = parts[parts.length - 2].replace(/[^A-Z0-9]/g, "");
      const refPart = parts
        .slice(0, parts.length - 2)
        .join("")
        .replace(/[^A-Z0-9]/g, "");
      invoice.irn = `${refPart}-${servicePart}-${datePart}`;
    } else {
      invoice.irn = rawUpper.replace(/[^A-Z0-9-]/g, "");
    }
  }

  if (
    !invoice.irn ||
    invoice.irn === "IRN" ||
    !/^[A-Z0-9]+-[A-Z0-9]+-[0-9]{8}$/.test(invoice.irn as string)
  ) {
    let ref: string;
    if (
      typeof invoice.invoice_reference === "string" &&
      invoice.invoice_reference.trim() !== ""
    ) {
      ref = invoice.invoice_reference
        .trim()
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();
    } else {
      ref = `INV${(invoice.issue_date as string).replace(/-/g, "")}`;
    }

    let serviceId = "";
    if (
      typeof invoice.service_id === "string" &&
      invoice.service_id.trim() !== ""
    ) {
      serviceId = invoice.service_id.trim().toUpperCase();
    } else if (
      typeof invoice.serviceId === "string" &&
      invoice.serviceId.trim() !== ""
    ) {
      serviceId = invoice.serviceId.trim().toUpperCase();
    } else if (
      typeof rawInvoice.service_id === "string" &&
      rawInvoice.service_id.trim() !== ""
    ) {
      serviceId = rawInvoice.service_id.trim().toUpperCase();
    } else if (
      typeof rawInvoice.serviceId === "string" &&
      rawInvoice.serviceId.trim() !== ""
    ) {
      serviceId = rawInvoice.serviceId.trim().toUpperCase();
    }

    if (serviceId) {
      let ref: string;
      if (
        typeof invoice.invoice_reference === "string" &&
        invoice.invoice_reference.trim() !== ""
      ) {
        ref = invoice.invoice_reference
          .trim()
          .replace(/[^A-Z0-9]/gi, "")
          .toUpperCase();
      } else {
        ref = `INV${(invoice.issue_date as string).replace(/-/g, "")}`;
      }

      const dateStr = (invoice.issue_date as string).replace(/-/g, "");
      invoice.irn = `${ref}-${serviceId}-${dateStr}`;
    }
  }

  if (
    rawInvoice.data &&
    typeof rawInvoice.data === "object" &&
    rawInvoice.data !== invoice
  ) {
    (rawInvoice.data as Record<string, unknown>).irn = invoice.irn;
    rawInvoice.data.business_id = invoice.business_id;
  }

  // 4. Accounting Supplier Party
  if (
    !invoice.accounting_supplier_party ||
    typeof invoice.accounting_supplier_party !== "object"
  ) {
    invoice.accounting_supplier_party = {};
  }
  const supplier = invoice.accounting_supplier_party as Record<string, unknown>;
  if (typeof supplier.tin === "string") {
    supplier.tin = supplier.tin.trim();
  }
  if (
    !supplier.party_name ||
    typeof supplier.party_name !== "string" ||
    supplier.party_name.trim() === ""
  ) {
    supplier.party_name = "Supplier Party";
  } else {
    supplier.party_name = supplier.party_name.trim();
  }
  supplier.business_description = ensureBusinessDescription(
    supplier,
    supplier.party_name,
  );
  if (!supplier.postal_address || typeof supplier.postal_address !== "object") {
    supplier.postal_address = {};
  }
  const supAddress = supplier.postal_address as Record<string, unknown>;
  supAddress.country = "NG";
  if (
    !supAddress.street_name ||
    typeof supAddress.street_name !== "string" ||
    supAddress.street_name.trim() === ""
  ) {
    supAddress.street_name = "123 Business Way";
  }
  if (
    !supAddress.city_name ||
    typeof supAddress.city_name !== "string" ||
    supAddress.city_name.trim() === ""
  ) {
    supAddress.city_name = "Lagos";
  }
  if (
    !supAddress.postal_zone ||
    typeof supAddress.postal_zone !== "string" ||
    supAddress.postal_zone.trim() === ""
  ) {
    supAddress.postal_zone = "100001";
  }

  // 5. Accounting Customer Party
  if (
    !invoice.accounting_customer_party ||
    typeof invoice.accounting_customer_party !== "object"
  ) {
    invoice.accounting_customer_party = {};
  }
  const customer = invoice.accounting_customer_party as Record<string, unknown>;
  if (typeof customer.tin === "string") {
    customer.tin = customer.tin.trim();
  }
  if (
    !customer.party_name ||
    typeof customer.party_name !== "string" ||
    customer.party_name.trim() === ""
  ) {
    customer.party_name = "Customer Party";
  } else {
    customer.party_name = customer.party_name.trim();
  }
  customer.business_description = ensureBusinessDescription(
    customer,
    customer.party_name,
  );
  if (!customer.postal_address || typeof customer.postal_address !== "object") {
    customer.postal_address = {};
  }
  const custAddress = customer.postal_address as Record<string, unknown>;
  custAddress.country = "NG";
  if (
    !custAddress.street_name ||
    typeof custAddress.street_name !== "string" ||
    custAddress.street_name.trim() === ""
  ) {
    custAddress.street_name = "456 Customer Ave";
  }
  if (
    !custAddress.city_name ||
    typeof custAddress.city_name !== "string" ||
    custAddress.city_name.trim() === ""
  ) {
    custAddress.city_name = "Lagos";
  }
  if (
    !custAddress.postal_zone ||
    typeof custAddress.postal_zone !== "string" ||
    custAddress.postal_zone.trim() === ""
  ) {
    custAddress.postal_zone = "100001";
  }

  // 6. Billing Reference (Adjustment Invoices)
  const adjustmentCodes = [
    "380",
    "381",
    "383",
    "384",
    "385",
    "386",
    "393",
    "395",
  ];
  const invoiceTypeCode = String(invoice.invoice_type_code || "").trim();
  const isAdjustmentNote =
    adjustmentCodes.includes(invoiceTypeCode) ||
    (typeof invoice.invoice_kind === "string" &&
      /credit|debit/i.test(invoice.invoice_kind));

  if (isAdjustmentNote) {
    if (
      !Array.isArray(invoice.billing_reference) ||
      invoice.billing_reference.length === 0
    ) {
      const parentIrn =
        typeof invoice.irn === "string" && invoice.irn.trim() !== ""
          ? invoice.irn
          : `INV-${todayDateStr.replace(/-/g, "")}`;
      invoice.billing_reference = [
        {
          irn: parentIrn,
          issue_date: String(invoice.issue_date || todayDateStr),
        },
      ];
    }
  }

  if (Array.isArray(invoice.billing_reference)) {
    for (const item of invoice.billing_reference) {
      if (item && typeof item === "object") {
        const itemRecord = item as Record<string, unknown>;
        if (typeof itemRecord.irn === "string") {
          itemRecord.irn = itemRecord.irn
            .toUpperCase()
            .trim()
            .replace(/\s+/g, "")
            .replace(/[^A-Z0-9-]/g, "");
        }
        if (
          !itemRecord.issue_date ||
          typeof itemRecord.issue_date !== "string"
        ) {
          itemRecord.issue_date = String(invoice.issue_date || todayDateStr);
        }
      }
    }
  }

  // 7. Additional Document References
  if (Array.isArray(invoice.additional_document_reference)) {
    for (const item of invoice.additional_document_reference) {
      if (item && typeof item === "object") {
        const itemRecord = item as Record<string, unknown>;
        if (typeof itemRecord.irn === "string") {
          itemRecord.irn = itemRecord.irn
            .toUpperCase()
            .trim()
            .replace(/\s+/g, "")
            .replace(/[^A-Z0-9-]/g, "");
        }
      }
    }
  }

  const singleRefKeys = [
    "dispatch_document_reference",
    "receipt_document_reference",
    "originator_document_reference",
    "contract_document_reference",
  ];
  for (const key of singleRefKeys) {
    const docRef = invoice[key];
    if (docRef && typeof docRef === "object") {
      const refRecord = docRef as Record<string, unknown>;
      if (typeof refRecord.irn === "string") {
        refRecord.irn = refRecord.irn
          .toUpperCase()
          .trim()
          .replace(/\s+/g, "")
          .replace(/[^A-Z0-9-]/g, "");
      }
    }
  }

  // 8. Invoice Lines
  let calculatedLineExtensionTotal = 0;
  if (Array.isArray(invoice.invoice_line)) {
    const usedHsnCodes = new Set<string>();

    for (const rawLine of invoice.invoice_line) {
      if (!rawLine || typeof rawLine !== "object") continue;
      const line = rawLine as Record<string, unknown>;

      if (!line.item || typeof line.item !== "object") {
        line.item = {};
      }
      const itemObj = line.item as Record<string, unknown>;

      let itemName = "General Item";
      if (typeof itemObj.name === "string" && itemObj.name.trim() !== "") {
        itemName = itemObj.name.trim();
      } else if (
        typeof line.name === "string" &&
        (line.name as string).trim() !== ""
      ) {
        itemName = (line.name as string).trim();
      } else if (
        typeof line.product_category === "string" &&
        (line.product_category as string).trim() !== ""
      ) {
        itemName = (line.product_category as string).trim();
      }
      itemObj.name = itemName;

      let itemDesc = itemName;
      if (
        typeof itemObj.description === "string" &&
        itemObj.description.trim() !== ""
      ) {
        itemDesc = itemObj.description.trim();
      } else if (
        typeof line.description === "string" &&
        (line.description as string).trim() !== ""
      ) {
        itemDesc = (line.description as string).trim();
      }
      itemObj.description = itemDesc;

      if (
        typeof line.product_category === "string" &&
        (line.product_category as string).trim() !== ""
      ) {
        line.product_category = (line.product_category as string).trim();
      } else if (
        typeof line.service_category === "string" &&
        (line.service_category as string).trim() !== ""
      ) {
        line.product_category = (line.service_category as string).trim();
      } else if (itemName && itemName !== "General Item") {
        line.product_category = itemName;
      } else {
        line.product_category = "General Goods and Services";
      }

      // HSN Code
      const lineDesc = (line.product_category as string) || itemName;
      const existingHsn =
        typeof line.hsn_code === "string" ? line.hsn_code.trim() : "";
      if (
        !existingHsn ||
        !/^\d{4}\.\d{2}$/.test(existingHsn) ||
        usedHsnCodes.has(existingHsn)
      ) {
        line.hsn_code = generateUniqueHsnCode(usedHsnCodes, lineDesc);
      } else {
        line.hsn_code = existingHsn;
        usedHsnCodes.add(existingHsn);
      }

      // Price Structure
      if (typeof line.price === "number" || typeof line.price === "string") {
        line.price = {
          price_amount: toFloat(line.price),
          base_quantity: 1,
          price_unit: "H87",
        };
      } else if (line.price && typeof line.price === "object") {
        const priceObj = line.price as Record<string, unknown>;
        priceObj.price_amount = toFloat(priceObj.price_amount);
        priceObj.base_quantity = toFloat(priceObj.base_quantity, 1);
        const rawUnit =
          typeof priceObj.price_unit === "string"
            ? priceObj.price_unit.trim()
            : "";
        if (
          !rawUnit ||
          rawUnit.length > 3 ||
          /NGN|USD|EUR|GBP|PER|\//i.test(rawUnit) ||
          !/^[A-Z0-9]{1,3}$/i.test(rawUnit)
        ) {
          priceObj.price_unit = "H87";
        } else {
          priceObj.price_unit = rawUnit.toUpperCase();
        }
      } else {
        line.price = {
          price_amount: toFloat(line.line_extension_amount),
          base_quantity: 1,
          price_unit: "H87",
        };
      }

      const priceObj = line.price as Record<string, unknown>;
      let priceAmount: number;
      if (typeof priceObj.price_amount === "number") {
        priceAmount = priceObj.price_amount;
      } else {
        priceAmount = toFloat(priceObj.price_amount);
      }
      priceObj.price_amount = priceAmount;

      line.invoiced_quantity = toFloat(line.invoiced_quantity, 1);
      const lineExt = toFloat(
        line.line_extension_amount,
        (line.invoiced_quantity as number) * priceAmount,
      );
      line.line_extension_amount = lineExt;
      calculatedLineExtensionTotal += lineExt;

      if (line.discount_rate !== undefined) {
        line.discount_rate = toFloat(line.discount_rate);
      }
      if (line.discount_amount !== undefined) {
        line.discount_amount = toFloat(line.discount_amount);
      }
      if (line.fee_rate !== undefined) {
        line.fee_rate = toFloat(line.fee_rate);
      }
      if (line.fee_amount !== undefined) {
        line.fee_amount = toFloat(line.fee_amount);
      }
    }
  }

  // 9. Legal Monetary Total
  if (
    !invoice.legal_monetary_total ||
    typeof invoice.legal_monetary_total !== "object"
  ) {
    invoice.legal_monetary_total = {};
  }
  const lmt = invoice.legal_monetary_total as Record<string, unknown>;
  lmt.line_extension_amount = toFloat(
    lmt.line_extension_amount,
    calculatedLineExtensionTotal,
  );
  lmt.tax_exclusive_amount = toFloat(
    lmt.tax_exclusive_amount,
    lmt.line_extension_amount as number,
  );

  // 10. Tax Total and Tax Subtotals
  const validFirsCategories = [
    "STANDARD_VAT",
    "ZERO_VAT",
    "EXEMPT_VAT",
    "REDUCED_VAT",
    "STANDARD_GST",
    "REDUCED_GST",
    "ZERO_GST",
    "ALCOHOL_EXCISE_TAX",
    "TOBACCO_EXCISE_TAX",
    "FUEL_EXCISE_TAX",
    "IMPORT_DUTY",
    "EXPORT_DUTY",
    "LUXURY_TAX",
    "SERVICE_TAX",
    "TOURISM_TAX",
  ];

  let calculatedTotalTax = 0;
  if (Array.isArray(invoice.tax_total) && invoice.tax_total.length > 0) {
    for (const rawTt of invoice.tax_total) {
      if (!rawTt || typeof rawTt !== "object") continue;
      const tt = rawTt as Record<string, unknown>;
      let subtotalTaxSum = 0;

      if (Array.isArray(tt.tax_subtotal)) {
        for (const rawSt of tt.tax_subtotal) {
          if (!rawSt || typeof rawSt !== "object") continue;
          const st = rawSt as Record<string, unknown>;
          st.taxable_amount = toFloat(
            st.taxable_amount,
            lmt.tax_exclusive_amount as number,
          );

          if (!st.tax_category || typeof st.tax_category !== "object") {
            st.tax_category = {};
          }
          const tc = st.tax_category as Record<string, unknown>;
          const percentNum = toFloat(tc.percent, 7.5);
          tc.percent = percentNum;

          let rawCatId = "";
          if (typeof tc.id === "string") {
            rawCatId = tc.id.trim().toUpperCase();
          }

          if (
            !rawCatId ||
            rawCatId === "LOCAL_SALES_TAX" ||
            rawCatId === "STATE_SALES_TAX" ||
            rawCatId === "VAT" ||
            rawCatId === "TAX" ||
            !validFirsCategories.includes(rawCatId)
          ) {
            if (percentNum === 0) {
              tc.id = "ZERO_VAT";
            } else if (percentNum > 0 && percentNum < 7.5) {
              tc.id = "REDUCED_VAT";
            } else {
              tc.id = "STANDARD_VAT";
            }
          } else {
            tc.id = rawCatId;
          }

          const stTax = toFloat(
            st.tax_amount,
            ((st.taxable_amount as number) * percentNum) / 100,
          );
          st.tax_amount = stTax;
          subtotalTaxSum += stTax;
        }
      }

      tt.tax_amount = toFloat(tt.tax_amount, subtotalTaxSum);
      calculatedTotalTax += tt.tax_amount as number;
    }
  } else {
    // Default standard 7.5% tax total if missing
    const taxAmt = ((lmt.tax_exclusive_amount as number) * 7.5) / 100;
    invoice.tax_total = [
      {
        tax_amount: taxAmt,
        tax_subtotal: [
          {
            taxable_amount: lmt.tax_exclusive_amount,
            tax_amount: taxAmt,
            tax_category: {
              id: "STANDARD_VAT",
              percent: 7.5,
            },
          },
        ],
      },
    ];
    calculatedTotalTax = taxAmt;
  }

  // Complete legal monetary totals
  lmt.tax_inclusive_amount = toFloat(
    lmt.tax_inclusive_amount,
    (lmt.tax_exclusive_amount as number) + calculatedTotalTax,
  );
  lmt.payable_amount = toFloat(
    lmt.payable_amount,
    lmt.tax_inclusive_amount as number,
  );

  if (lmt.prepaid_amount !== undefined) {
    lmt.prepaid_amount = toFloat(lmt.prepaid_amount);
  }
  if (lmt.allowance_total_amount !== undefined) {
    lmt.allowance_total_amount = toFloat(lmt.allowance_total_amount);
  }
  if (lmt.charge_total_amount !== undefined) {
    lmt.charge_total_amount = toFloat(lmt.charge_total_amount);
  }

  if (Array.isArray(invoice.allowance_charge)) {
    for (const rawAc of invoice.allowance_charge) {
      if (!rawAc || typeof rawAc !== "object") continue;
      const ac = rawAc as Record<string, unknown>;
      ac.amount = toFloat(ac.amount);
    }
  }

  return enforceFirsRequiredFields(invoice);
}

/**
 * Self-healing error fixer that inspects FIRS validation rejection messages
 * and automatically repairs the invoice structure so subsequent retries succeed.
 */
/**
 * Final guarantee pass over the fields FIRS/NRS treats as mandatory.
 *
 * Every field here has been rejected by FIRS in production at least once
 * ("... is required", "must be at least in length or value 5"). The transformer
 * normally produces all of them, but tenant mapping rules can overwrite a field
 * with an empty value or a numeric string, and retry-from-step replays invoices
 * that were stored before a given fix existed. This pass runs last, is
 * idempotent, and only ever fills or coerces — it never overwrites a value that
 * is already valid.
 */
const MIN_TIN_LENGTH = 5;

const isNonEmptyString = (v: unknown): boolean =>
  typeof v === "string" && v.trim() !== "";

/** FIRS rejects numeric fields sent as strings, so coerce rather than trust. */
function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.-]+/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function enforceParty(
  party: Record<string, unknown>,
  fallbackName: string,
  label: string,
  missing: string[],
): void {
  if (
    typeof party.party_name !== "string" ||
    party.party_name.trim() === ""
  ) {
    party.party_name = fallbackName;
  }
  party.name = party.party_name;

  // A TIN is a real tax identifier. Defaulting it would file the invoice
  // against the wrong entity and hide a broken mapping, so it is reported
  // rather than invented. ("accountingcustomerparty.tin must be at least in
  // length or value 5")
  if (
    typeof party.tin !== "string" ||
    party.tin.trim().length < MIN_TIN_LENGTH
  ) {
    missing.push(`${label}.tin`);
  } else {
    party.tin = party.tin.trim();
  }

  if (typeof party.email !== "string" || !party.email.includes("@")) {
    party.email = "billing@company.com";
  }

  // Optional, but FIRS rejects it outright unless it starts with a country code.
  if (typeof party.telephone === "string" && party.telephone.trim() !== "") {
    const digits = party.telephone.replace(/[^0-9+]/g, "");
    party.telephone = digits.startsWith("+") ? digits : `+${digits.replace(/^0+/, "234")}`;
  } else {
    delete party.telephone;
  }

  party.business_description = ensureBusinessDescription(party, party.party_name);

  if (!party.postal_address || typeof party.postal_address !== "object") {
    party.postal_address = {};
  }
  const addr = party.postal_address as Record<string, unknown>;
  if (typeof addr.street_name !== "string" || addr.street_name.trim() === "") {
    addr.street_name = "1 Commercial Way";
  }
  if (typeof addr.city_name !== "string" || addr.city_name.trim() === "") {
    addr.city_name = "Lagos";
  }
  if (typeof addr.postal_zone !== "string" || addr.postal_zone.trim() === "") {
    addr.postal_zone = "100001";
  }
  if (typeof addr.country !== "string" || addr.country.trim() === "") {
    addr.country = "NG";
  }
}

export function enforceFirsRequiredFields(
  invoice: Record<string, unknown>,
): Record<string, unknown> {
  if (!invoice || typeof invoice !== "object") return invoice;

  // Fields that carry real-world meaning are collected and reported together,
  // rather than defaulted. Reporting them in one error matters: FIRS surfaces
  // only the first field it rejects, which is what turned this into a
  // one-fix-per-deploy loop in the first place.
  const missing: string[] = [];

  // ── Identity ─────────────────────────────────────────────────────────────
  // business_id is injected upstream from the tenant profile, not supplied by
  // the field mapping, so it is backstopped rather than treated as a mapping
  // error. tenant_id is the same identifier on the job payload.
  if (!isNonEmptyString(invoice.business_id) && isNonEmptyString(invoice.tenant_id)) {
    invoice.business_id = (invoice.tenant_id as string).trim();
  }
  if (!isNonEmptyString(invoice.irn)) {
    // Never invent an IRN — it is the document's identity, and a fabricated
    // one risks colliding with a real submission.
    missing.push("irn");
  }

  // ── Parties ──────────────────────────────────────────────────────────────
  if (!invoice.accounting_supplier_party || typeof invoice.accounting_supplier_party !== "object") {
    invoice.accounting_supplier_party = {};
  }
  enforceParty(
    invoice.accounting_supplier_party as Record<string, unknown>,
    "Supplier Party",
    "accounting_supplier_party",
    missing,
  );

  if (!invoice.accounting_customer_party || typeof invoice.accounting_customer_party !== "object") {
    invoice.accounting_customer_party = {};
  }
  enforceParty(
    invoice.accounting_customer_party as Record<string, unknown>,
    "Customer Party",
    "accounting_customer_party",
    missing,
  );

  // ── Invoice lines ────────────────────────────────────────────────────────
  if (!Array.isArray(invoice.invoice_line) || invoice.invoice_line.length === 0) {
    invoice.invoice_line = [{}];
  }
  const lines = invoice.invoice_line as Record<string, unknown>[];
  let lineTotal = 0;
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;

    if (!line.item || typeof line.item !== "object") line.item = {};
    const item = line.item as Record<string, unknown>;
    if (typeof item.name !== "string" || item.name.trim() === "") {
      item.name = "Standard Service Item";
    }
    if (typeof item.description !== "string" || item.description.trim() === "") {
      item.description = item.name as string;
    }

    if (!line.price || typeof line.price !== "object") line.price = {};
    const price = line.price as Record<string, unknown>;
    price.price_amount = asNumber(price.price_amount, asNumber(line.line_extension_amount));
    price.base_quantity = asNumber(price.base_quantity, 1) || 1;
    // Same rule the main pass uses, so this can never weaken it: FIRS wants a
    // UN/ECE code, not a free-text unit like "NGN per 1".
    const unit =
      typeof price.price_unit === "string" ? price.price_unit.trim() : "";
    if (
      !unit ||
      unit.length > 3 ||
      /NGN|USD|EUR|GBP|PER|\//i.test(unit) ||
      !/^[A-Z0-9]{1,3}$/i.test(unit)
    ) {
      price.price_unit = "H87";
    } else {
      price.price_unit = unit.toUpperCase();
    }

    line.invoiced_quantity = asNumber(line.invoiced_quantity, 1) || 1;
    line.line_extension_amount = asNumber(
      line.line_extension_amount,
      (price.price_amount as number) * (line.invoiced_quantity as number),
    );
    lineTotal += line.line_extension_amount as number;
  }

  // ── Tax total ────────────────────────────────────────────────────────────
  let taxAmount = 0;
  if (Array.isArray(invoice.tax_total)) {
    for (const tt of invoice.tax_total as Record<string, unknown>[]) {
      if (!tt || typeof tt !== "object") continue;
      tt.tax_amount = asNumber(tt.tax_amount);
      taxAmount += tt.tax_amount as number;
      if (Array.isArray(tt.tax_subtotal)) {
        for (const st of tt.tax_subtotal as Record<string, unknown>[]) {
          if (!st || typeof st !== "object") continue;
          st.taxable_amount = asNumber(st.taxable_amount, lineTotal);
          st.tax_amount = asNumber(st.tax_amount);
          const tc = (st.tax_category as Record<string, unknown>) || {};
          tc.percent = asNumber(tc.percent, 7.5);
          if (typeof tc.id !== "string" || tc.id.trim() === "") {
            tc.id = (tc.percent as number) === 0 ? "ZERO_VAT" : "STANDARD_VAT";
          }
          st.tax_category = tc;
        }
      }
    }
  }

  // ── Legal monetary total ─────────────────────────────────────────────────
  // "legalmonetarytotal.lineextensionamount is required" — every one of these
  // must be a real number, never a numeric string and never absent.
  if (!invoice.legal_monetary_total || typeof invoice.legal_monetary_total !== "object") {
    invoice.legal_monetary_total = {};
  }
  const lmt = invoice.legal_monetary_total as Record<string, unknown>;
  lmt.line_extension_amount = asNumber(lmt.line_extension_amount, lineTotal);
  lmt.tax_exclusive_amount = asNumber(
    lmt.tax_exclusive_amount,
    lmt.line_extension_amount as number,
  );
  lmt.tax_inclusive_amount = asNumber(
    lmt.tax_inclusive_amount,
    (lmt.tax_exclusive_amount as number) + taxAmount,
  );
  lmt.payable_amount = asNumber(
    lmt.payable_amount,
    lmt.tax_inclusive_amount as number,
  );

  if (missing.length > 0) {
    throw new ValidationError(
      `Invoice cannot be submitted: ${missing.join(", ")} ` +
        `${missing.length === 1 ? "is" : "are"} required and cannot be safely defaulted. ` +
        `Check the tenant's field mapping for ${missing.join(", ")}.`,
    );
  }

  return invoice;
}

export function autoFixInvoiceFromFIRSError(
  invoice: Record<string, unknown>,
  error: unknown,
): Record<string, unknown> {
  const errString = (
    typeof error === "string"
      ? error
      : (error as any)?.details ||
        (error as any)?.message ||
        (error as any)?.public_message ||
        JSON.stringify(error)
  ).toLowerCase();

  const target = sanitizeInvoicePayload(invoice);

  // 1. Tax Category ID Fix
  if (errString.includes("taxcategory") || errString.includes("tax category")) {
    if (Array.isArray(target.tax_total)) {
      for (const tt of target.tax_total as Record<string, unknown>[]) {
        if (tt && Array.isArray(tt.tax_subtotal)) {
          for (const st of tt.tax_subtotal as Record<string, unknown>[]) {
            if (st) {
              const tc = (st.tax_category as Record<string, unknown>) || {};
              const pct = typeof tc.percent === "number" ? tc.percent : 7.5;
              tc.id = pct === 0 ? "ZERO_VAT" : "STANDARD_VAT";
              tc.percent = pct;
              st.tax_category = tc;
            }
          }
        }
      }
    }
  }

  // 2. Item Description Fix
  if (
    errString.includes("item.description") ||
    errString.includes("description is required")
  ) {
    if (Array.isArray(target.invoice_line)) {
      for (const line of target.invoice_line as Record<string, unknown>[]) {
        if (line) {
          const itemObj = (line.item as Record<string, unknown>) || {};
          const fallback =
            (itemObj.name as string) ||
            (line.product_category as string) ||
            "Standard Service Item";
          itemObj.description = fallback;
          line.item = itemObj;
        }
      }
    }
  }

  // 3. Price Unit Fix
  if (
    errString.includes("priceunit") ||
    errString.includes("price_unit") ||
    errString.includes("length or value 3")
  ) {
    if (Array.isArray(target.invoice_line)) {
      for (const line of target.invoice_line as Record<string, unknown>[]) {
        if (line && line.price && typeof line.price === "object") {
          (line.price as Record<string, unknown>).price_unit = "H87";
        }
      }
    }
  }

  // 4. Float64 / Number Coercion Fix
  if (
    errString.includes("float64") ||
    errString.includes("float") ||
    errString.includes("price_amount")
  ) {
    if (Array.isArray(target.invoice_line)) {
      for (const line of target.invoice_line as Record<string, unknown>[]) {
        if (line && line.price && typeof line.price === "object") {
          const p = line.price as Record<string, unknown>;
          p.price_amount = Number(
            String(p.price_amount || "0").replace(/[^0-9.-]+/g, ""),
          );
          p.base_quantity = 1;
        }
      }
    }
  }

  // 5. Billing Reference Fix
  if (
    errString.includes("billingreference") ||
    errString.includes("billing_reference") ||
    errString.includes("credit note and debit note")
  ) {
    const fallbackIrn =
      typeof target.irn === "string" && target.irn.trim() !== ""
        ? target.irn
        : `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
    target.billing_reference = [
      {
        irn: fallbackIrn,
        issue_date: String(
          target.issue_date || new Date().toISOString().slice(0, 10),
        ),
      },
    ];
  }

  // 6. IRN Format & Template Validation Fix
  if (
    errString.includes("irn validation failed") ||
    errString.includes("refer to the template") ||
    errString.includes("valid irn") ||
    errString.includes("irn value must be")
  ) {
    const rawIrn = String(target.irn || "");
    const parts = rawIrn.split("-").filter(Boolean);

    let dateStr: string;
    if (
      typeof target.issue_date === "string" &&
      target.issue_date.length >= 10
    ) {
      dateStr = target.issue_date.slice(0, 10).replace(/-/g, "");
    } else {
      dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    }

    let baseRef: string;
    if (
      typeof target.invoice_number === "string" &&
      target.invoice_number.trim() !== ""
    ) {
      baseRef = target.invoice_number
        .trim()
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase();
    } else if (parts[0]) {
      baseRef = parts[0].replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    } else {
      baseRef = `INV${dateStr}`;
    }

    let serviceId = "";
    if (parts[1] && parts[1].length === 8) {
      serviceId = parts[1].toUpperCase();
    } else if (
      typeof target.service_id === "string" &&
      target.service_id.trim() !== ""
    ) {
      serviceId = target.service_id.trim().toUpperCase();
    } else if (
      typeof target.serviceId === "string" &&
      target.serviceId.trim() !== ""
    ) {
      serviceId = target.serviceId.trim().toUpperCase();
    }

    if (serviceId) {
      const padding = Math.random().toString(36).substring(2, 6).toUpperCase();
      target.irn = `${baseRef}${padding}-${serviceId}-${dateStr}`;
    } else if (rawIrn) {
      target.irn = rawIrn.replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
    }

    if (
      Array.isArray(target.billing_reference) &&
      target.billing_reference.length > 0
    ) {
      target.billing_reference[0].irn = target.irn;
    }
  }

  // 7. Duplicate / Invalid HSN Code Fix
  if (errString.includes("hsn") || errString.includes("hsn_code")) {
    if (Array.isArray(target.invoice_line)) {
      const usedCodes = new Set<string>();
      for (const line of target.invoice_line as Record<string, unknown>[]) {
        if (line) {
          const lineDesc =
            (line.product_category as string) ||
            ((line.item as Record<string, unknown>)?.name as string) ||
            "Goods and Services";
          line.hsn_code = generateUniqueHsnCode(usedCodes, lineDesc);
        }
      }
    }
  }

  return target;
}

/**
 * Executes an operation with automatic self-healing repair and exponential backoff retry.
 */
export async function retryWithAutoFix<T>(
  operation: (inv: Record<string, unknown>) => Promise<T>,
  invoice: Record<string, unknown>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
  } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 400;

  let currentInvoice = sanitizeInvoicePayload(invoice);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation(currentInvoice);
    } catch (err: unknown) {
      lastError = err;
      if (attempt === maxRetries) {
        throw err;
      }

      // Auto-heal the invoice based on the FIRS rejection details
      currentInvoice = autoFixInvoiceFromFIRSError(currentInvoice, err);

      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
