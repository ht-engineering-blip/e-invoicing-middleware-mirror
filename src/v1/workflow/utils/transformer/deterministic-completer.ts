import type { AuthContext, ISchemaField } from "./mapping-spec.types";
import {
  extractCurrency,
  generateInvoiceRef,
  generateIRN,
  isIRNPlaceholder,
  resolveCurrencyCode,
  sanitizeHsnCode,
  sanitizePriceUnit,
} from "./utils";
import { ensureBusinessDescription } from "../invoice-sanitizer.util";
import { DEFAULT_INVOICE_TYPE_CODE } from "../invoice-type";
import { generateUniqueHsnCode } from "./classification.helper";

import {
  Address,
  Party,
  InvoiceLine,
  LegalMonetaryTotal,
  TaxTotal,
  TaxSubtotal,
  FIRSInvoice,
} from "./schema-validator";

export interface PlaceholderContext {
  authContext?: AuthContext;
  irn?: string;
  invoiceRef?: string;
  issueDate?: string;
  issueTime?: string;
}

export interface ReconcileResult {
  completedData: FIRSInvoice;
  isFullyCompliant: boolean;
  missingFields: string[];
  mathHealed: boolean;
  adjustmentsMade: string[];
}

export class DeterministicCompleter {
  /**
   * Safe float conversion with fallback
   */
  static toFloat(val: unknown, fallback: number = 0): number {
    if (typeof val === "number") return isNaN(val) ? fallback : val;
    if (typeof val === "string") {
      const cleaned = val.replace(/[^0-9.-]+/g, "");
      const num = Number(cleaned);
      return isNaN(num) ? fallback : num;
    }
    return fallback;
  }

  /**
   * Safe float conversion that preserves undefined/null for optional fields
   */
  static toFloatOptional(val: unknown): number | undefined {
    if (val === undefined || val === null || val === "") return undefined;
    const num = this.toFloat(val, NaN);
    return isNaN(num) ? undefined : num;
  }

  /**
   * Safe string conversion that trims and preserves undefined/null for empty inputs
   */
  static toStringOptional(val: unknown): string | undefined {
    if (val === undefined || val === null) return undefined;
    const str = String(val).trim();
    return str.length > 0 ? str : undefined;
  }

  /**
   * Traverses object to get nested value safely
   */
  static getDeepValue(obj: unknown, path: string): unknown {
    if (!path || typeof path !== "string" || !obj || typeof obj !== "object")
      return undefined;
    const keys = path
      .replace(/\[(\d+|\*)\]/g, ".$1")
      .split(".")
      .filter(Boolean);

    let current: any = obj;
    for (const key of keys) {
      if (current == null || typeof current !== "object") return undefined;
      if (key === "__proto__" || key === "constructor" || key === "prototype")
        return undefined;
      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
      current = current[key];
    }
    return current;
  }

  /**
   * Sets nested value safely
   */
  static setDeepValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    if (!obj || typeof obj !== "object" || !path || typeof path !== "string")
      return;
    const keys = path
      .replace(/\[(\d+|\*)\]/g, ".$1")
      .split(".")
      .filter(Boolean);

    let current: any = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const nextKey = keys[i + 1];
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new Error("Prototype pollution attempt detected");
      }
      if (current[key] == null || typeof current[key] !== "object") {
        current[key] = /^\d+$/.test(nextKey) ? [] : {};
      }
      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
      current = current[key];
    }

    const last = keys[keys.length - 1];
    if (
      last === "__proto__" ||
      last === "constructor" ||
      last === "prototype"
    ) {
      throw new Error("Prototype pollution attempt detected");
    }
    current[last] = value;
  }

  /**
   * Checks if an unknown value is a non-empty array
   */
  static isNonEmptyArray(val: unknown): val is any[] {
    return Array.isArray(val) && val.length > 0;
  }

  /**
   * Retrieves the first non-empty array from candidate values
   */
  static getFirstNonEmptyArray(...candidates: unknown[]): any[] {
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (this.isNonEmptyArray(candidate)) {
        return candidate;
      }
    }
    return [];
  }

  /**
   * Safe extraction of a plain dictionary/object, returning fallback if not a valid non-array object
   */
  static toObject<T extends Record<string, unknown> = Record<string, unknown>>(
    val: unknown,
    fallback: T = {} as T,
  ): T {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return val as T;
    }
    return fallback;
  }

  /**
   * Fully reconciles and auto-completes an invoice payload deterministically
   */
  static reconcileAndComplete(
    data: Record<string, unknown>,
    authContext?: AuthContext,
    firsSchema?: ISchemaField[],
    currencies: any[] = [],
  ): ReconcileResult {
    const dataObj = this.toObject(data?.data);
    const invObj = this.toObject(data?.invoice);
    let res: Record<string, any> = { ...dataObj, ...invObj, ...data };
    const adjustments: string[] = [];
    let mathHealed = false;

    // Address & Email Helpers: exact extraction without dummy placeholder strings
    const extractAddress = (
      given?: Partial<Address> | Record<string, unknown>,
    ): Address => {
      const addr = this.toObject(given) as Partial<Address> & {
        address?: string;
        city?: string;
        zip?: string;
      };
      return {
        street_name:
          this.toStringOptional(addr.street_name) ??
          this.toStringOptional(addr.address) ??
          "",
        city_name:
          this.toStringOptional(addr.city_name) ??
          this.toStringOptional(addr.city) ??
          "",
        postal_zone:
          this.toStringOptional(addr.postal_zone) ??
          this.toStringOptional(addr.zip) ??
          "",
        country: this.toStringOptional(addr.country) ?? "NG",
        state: this.toStringOptional(addr.state),
        lga: this.toStringOptional(addr.lga),
      };
    };

    const extractEmail = (given?: unknown): string => {
      const str = this.toStringOptional(given);
      return str && str.includes("@") ? str : "";
    };

    // 1. Identity & Supplier Information (Exact Priority -> AuthContext > Explicit Payload)
    const businessId =
      this.toStringOptional(authContext?.businessId) ??
      this.toStringOptional(authContext?.tenantId) ??
      this.toStringOptional(res.business_id) ??
      "BUS-DEFAULT-01";
    res.business_id = businessId;

    const rawSupplier = this.toObject(
      res.accounting_supplier_party,
    ) as Partial<Party> & {
      name?: string;
    };
    const rawSupplierTin = this.toStringOptional(rawSupplier.tin);
    const cleanSupplierTin =
      rawSupplierTin && !rawSupplierTin.startsWith("{{")
        ? rawSupplierTin
        : undefined;
    const supplierTIN =
      this.toStringOptional(authContext?.businessTIN) ??
      cleanSupplierTin ??
      this.toStringOptional(res.supplier_tin) ??
      "00364075-0001";

    const rawSupplierName =
      this.toStringOptional(rawSupplier.party_name) ??
      this.toStringOptional(rawSupplier.name);
    const cleanSupplierName =
      rawSupplierName && !rawSupplierName.startsWith("{{")
        ? rawSupplierName
        : undefined;
    const supplierPartyName =
      this.toStringOptional(authContext?.businessName) ??
      cleanSupplierName ??
      "Heirs Technologies HQ";

    const rawSupplierEmail = extractEmail(rawSupplier.email);
    const cleanSupplierEmail =
      rawSupplierEmail && !rawSupplierEmail.startsWith("{{")
        ? rawSupplierEmail
        : undefined;
    const supplierEmail =
      cleanSupplierEmail ||
      extractEmail(authContext?.email) ||
      "finance@heirstechnologies.com";

    const supplier: Party = {
      tin: supplierTIN,
      party_name: supplierPartyName,
      email: supplierEmail,
      telephone: this.toStringOptional(rawSupplier.telephone),
      business_description: this.toStringOptional(
        rawSupplier.business_description,
      ),
      postal_address: extractAddress(
        rawSupplier.postal_address as Partial<Address>,
      ),
    };
    res.accounting_supplier_party = supplier;

    // 2. Customer Party (Exact Priority -> Explicit Payload)
    const rawCustomer = this.toObject(
      res.accounting_customer_party,
    ) as Partial<Party> & {
      name?: string;
    };
    const customerPartyName =
      this.toStringOptional(rawCustomer.party_name) ??
      this.toStringOptional(rawCustomer.name) ??
      this.toStringOptional(res.customer_name) ??
      this.toStringOptional(res.buyer_name) ??
      "Customer";

    const customerTIN =
      this.toStringOptional(rawCustomer.tin) ??
      this.toStringOptional(res.customer_tin) ??
      this.toStringOptional(res.buyer_tin) ??
      "";

    const rawCustomerEmail = extractEmail(rawCustomer.email);
    const cleanCustomerEmail =
      rawCustomerEmail && !rawCustomerEmail.startsWith("{{")
        ? rawCustomerEmail
        : undefined;
    let customerEmail = cleanCustomerEmail;
    if (!customerEmail) {
      const cleanName = (customerPartyName || "customer")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 15);
      customerEmail = `billing@${cleanName || "customer"}.com`;
      adjustments.push("Auto-generated customer compliance contact email");
    }

    const customer: Party = {
      tin: customerTIN,
      party_name: customerPartyName,
      email: customerEmail,
      telephone: this.toStringOptional(rawCustomer.telephone),
      business_description: this.toStringOptional(
        rawCustomer.business_description,
      ),
      postal_address: extractAddress(
        rawCustomer.postal_address as Partial<Address>,
      ),
    };
    res.accounting_customer_party = customer;

    // 3. IRN & Invoice Reference Resolution
    const invoiceRef =
      this.toStringOptional(res.invoice_reference) ??
      this.toStringOptional(res.invoice_number) ??
      this.toStringOptional(res.invoice_id) ??
      this.toStringOptional(res.irn) ??
      "";
    if (invoiceRef) {
      res.invoice_reference = invoiceRef;
    }

    // 4. Dates & Times
    if (
      !res.issue_date ||
      typeof res.issue_date !== "string" ||
      !res.issue_date.trim()
    ) {
      res.issue_date = new Date().toISOString().slice(0, 10);
      adjustments.push("Defaulted issue_date to current date");
    }
    if (
      !res.issue_time ||
      typeof res.issue_time !== "string" ||
      !res.issue_time.trim()
    ) {
      res.issue_time = new Date().toTimeString().slice(0, 8);
      adjustments.push("Defaulted issue_time to current time");
    }

    const rawIrn = typeof res.irn === "string" ? res.irn.trim() : "";
    const isPlaceholder =
      !rawIrn || isIRNPlaceholder(rawIrn) || rawIrn.startsWith("{{");

    const targetRef =
      invoiceRef || (!isPlaceholder ? rawIrn : "") || "INV-SAMPLE";
    const serviceId = authContext?.serviceId;
    const parsedDate = new Date(String(res.issue_date));
    const issueDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
    const generated = generateIRN(targetRef, serviceId, issueDate);
    if (generated) {
      res.irn = generated;
      adjustments.push("Auto-generated IRN");
    }

    // 5. Invoice Type Code & Kind
    res.invoice_type_code = String(
      res.invoice_type_code || DEFAULT_INVOICE_TYPE_CODE,
    ).trim();

    res.invoice_kind = String(res.invoice_kind || "B2B").trim();

    // 6. Currencies
    const docCurr = extractCurrency(res, "document", currencies) || "NGN";
    res.document_currency_code = resolveCurrencyCode(docCurr, currencies);
    const taxCurr =
      extractCurrency(res, "tax", currencies) || res.document_currency_code;
    res.tax_currency_code = resolveCurrencyCode(taxCurr, currencies);

    // 7. Payment Status & Payment Means
    if (!res.payment_status) {
      res.payment_status = "PENDING";
    }
    if (res.payment_means) {
      if (!Array.isArray(res.payment_means)) {
        res.payment_means =
          typeof res.payment_means === "object"
            ? [res.payment_means]
            : undefined;
      }
    }

    // 8. Line Items Normalization & Mathematical Reconciliation
    const rawLines = this.getFirstNonEmptyArray(
      res.invoice_line,
      dataObj.invoice_line,
      invObj.invoice_line,
      res.invoiceLine,
      dataObj.invoiceLine,
      res.line_items,
      dataObj.line_items,
      res.invoice?.line_items,
      invObj.line_items,
      res.items,
      dataObj.items,
      res.lines,
      dataObj.lines,
      res.invoice_line,
    );

    let computedLineExtensionTotal = 0;
    const normalizedLines: InvoiceLine[] = [];
    const usedHsnCodes = new Set<string>();

    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] || {};
      const itemRaw = raw.item && typeof raw.item === "object" ? raw.item : {};
      const priceRaw =
        raw.price && typeof raw.price === "object" ? raw.price : {};

      const qty = this.toFloat(raw.invoiced_quantity ?? raw.quantity ?? 1, 1);
      let priceAmount = this.toFloat(
        priceRaw.price_amount ??
          raw.unit_price ??
          raw.price ??
          raw.rate ??
          raw.sales_rate ??
          raw.bcy_rate ??
          0,
      );
      const baseQty = this.toFloat(priceRaw.base_quantity ?? 1, 1);

      let lineAmount = (qty * priceAmount) / baseQty;
      if (raw.line_extension_amount !== undefined) {
        const givenAmount = this.toFloat(raw.line_extension_amount);
        if (givenAmount > 0) lineAmount = givenAmount;
      } else if (raw.total !== undefined) {
        const givenTotal = this.toFloat(raw.total);
        if (givenTotal > 0) lineAmount = givenTotal;
      }

      if (priceAmount === 0 && qty > 0 && lineAmount > 0) {
        priceAmount = lineAmount / qty;
        mathHealed = true;
        adjustments.push(
          `Line ${i + 1}: Back-calculated price_amount from line total`,
        );
      }

      computedLineExtensionTotal += lineAmount;

      const itemName = (
        (typeof itemRaw.name === "string" ? itemRaw.name : "") ||
        (typeof raw.name === "string" ? raw.name : "") ||
        (typeof raw.description === "string" ? raw.description : "")
      ).trim();
      const itemDesc = (
        (typeof itemRaw.description === "string" ? itemRaw.description : "") ||
        (typeof raw.description === "string" ? raw.description : "") ||
        itemName
      ).trim();
      const category =
        (
          (typeof raw.product_category === "string"
            ? raw.product_category
            : "") ||
          (typeof raw.service_category === "string" ? raw.service_category : "")
        ).trim() || undefined;

      const rawUnit = String(priceRaw.price_unit || raw.unit || "H87").trim();
      const priceUnit = sanitizePriceUnit(rawUnit);

      let lineHsn = this.toStringOptional(raw.hsn_code);
      if (lineHsn) {
        lineHsn = sanitizeHsnCode(lineHsn) || lineHsn;
      }
      if (!lineHsn || !/^\d{4}\.\d{2}$/.test(lineHsn)) {
        lineHsn = generateUniqueHsnCode(usedHsnCodes, itemName || itemDesc);
        adjustments.push(
          `Line ${i + 1}: Auto-assigned standard HSN code ${lineHsn}`,
        );
      } else {
        usedHsnCodes.add(lineHsn);
      }

      normalizedLines.push({
        hsn_code: lineHsn,
        isic_code: this.toStringOptional(raw.isic_code),
        product_category: category,
        invoiced_quantity: qty,
        line_extension_amount: lineAmount,
        item: {
          name: itemName,
          description: itemDesc,
          sellers_item_identification: this.toStringOptional(
            itemRaw.sellers_item_identification,
          ),
        },
        price: {
          price_amount: priceAmount,
          base_quantity: baseQty,
          price_unit: priceUnit,
        },
        discount_rate: this.toFloatOptional(raw.discount_rate),
        discount_amount: this.toFloatOptional(raw.discount_amount),
        fee_rate: this.toFloatOptional(raw.fee_rate),
        fee_amount: this.toFloatOptional(raw.fee_amount),
      });
    }

    res.invoice_line = normalizedLines;

    // 9. Tax Total Calculation & Auto-Categorization (Strongly Typed TaxTotal[])
    let totalTaxAmount = 0;
    const rawTaxTotalCandidate = this.getFirstNonEmptyArray(
      res.tax_total,
      dataObj.tax_total,
      invObj.tax_total,
    );

    let normalizedTaxTotals: TaxTotal[] = [];

    if (rawTaxTotalCandidate.length > 0) {
      for (const tt of rawTaxTotalCandidate) {
        if (!tt || typeof tt !== "object") continue;
        const rawTt = tt as Partial<TaxTotal>;
        const ttTaxAmount = this.toFloat(rawTt.tax_amount);
        const subtotals: TaxSubtotal[] = [];

        if (Array.isArray(rawTt.tax_subtotal)) {
          for (const st of rawTt.tax_subtotal) {
            if (!st || typeof st !== "object") continue;
            const rawSt = st as Partial<TaxSubtotal>;
            const taxableAmt = this.toFloat(
              rawSt.taxable_amount,
              computedLineExtensionTotal,
            );
            const stTaxAmt = this.toFloat(rawSt.tax_amount);
            const rawCat = (
              rawSt.tax_category && typeof rawSt.tax_category === "object"
                ? rawSt.tax_category
                : {}
            ) as Partial<TaxSubtotal["tax_category"]>;
            let pct = this.toFloat(rawCat?.percent, 7.5);
            let catId = this.toStringOptional(rawCat?.id)?.toUpperCase() ?? "";

            if (catId === "STANDARD_VAT" || (!catId && pct > 0)) {
              catId = "STANDARD_VAT";
              pct = 7.5;
            } else if (
              catId === "ZERO_VAT" ||
              catId === "EXEMPT_VAT" ||
              pct === 0
            ) {
              catId = catId || "ZERO_VAT";
              pct = 0;
            } else if (pct === 7.5) {
              catId = "STANDARD_VAT";
            }

            subtotals.push({
              taxable_amount: taxableAmt,
              tax_amount: stTaxAmt,
              tax_category: {
                id: catId || "STANDARD_VAT",
                percent: pct,
              },
            });
          }
        }

        if (subtotals.length === 0) {
          subtotals.push({
            taxable_amount: computedLineExtensionTotal,
            tax_amount: ttTaxAmount,
            tax_category: {
              id: "STANDARD_VAT",
              percent: 7.5,
            },
          });
        }

        totalTaxAmount += ttTaxAmount;
        normalizedTaxTotals.push({
          tax_amount: ttTaxAmount,
          tax_subtotal: subtotals,
        });
      }
    }

    if (normalizedTaxTotals.length === 0) {
      const estimatedVat = computedLineExtensionTotal * 0.075;
      totalTaxAmount = estimatedVat;
      normalizedTaxTotals = [
        {
          tax_amount: estimatedVat,
          tax_subtotal: [
            {
              taxable_amount: computedLineExtensionTotal,
              tax_amount: estimatedVat,
              tax_category: {
                id: "STANDARD_VAT",
                percent: 7.5,
              },
            },
          ],
        },
      ];
      adjustments.push(
        "Auto-computed 7.5% STANDARD_VAT tax_total subtotal structure",
      );
    }
    res.tax_total = normalizedTaxTotals;

    // 10. Legal Monetary Total Mathematical Reconciliation (Strongly Typed LegalMonetaryTotal)
    const lmtSource = this.toObject(
      res.legal_monetary_total ||
        dataObj.legal_monetary_total ||
        invObj.legal_monetary_total,
    );

    const rawLineExt = this.toFloat(lmtSource.line_extension_amount, 0);
    const lineExt = rawLineExt > 0 ? rawLineExt : computedLineExtensionTotal;

    const rawTaxExcl = this.toFloat(lmtSource.tax_exclusive_amount, 0);
    const taxExcl = rawTaxExcl > 0 ? rawTaxExcl : lineExt;

    const rawTaxIncl = this.toFloat(lmtSource.tax_inclusive_amount, 0);
    const taxIncl = rawTaxIncl > 0 ? rawTaxIncl : taxExcl + totalTaxAmount;

    const prepaid = this.toFloat(lmtSource.prepaid_amount, 0);

    const rawPayable = this.toFloat(lmtSource.payable_amount, 0);
    const payable = rawPayable > 0 ? rawPayable : taxIncl - prepaid;

    if (
      lmtSource.payable_amount !== payable ||
      lmtSource.line_extension_amount !== lineExt
    ) {
      mathHealed = true;
      adjustments.push("Reconciled legal_monetary_total mathematical totals");
    }

    const legalMonetaryTotal: LegalMonetaryTotal = {
      line_extension_amount: lineExt,
      tax_exclusive_amount: taxExcl,
      tax_inclusive_amount: taxIncl,
      payable_amount: payable,
      prepaid_amount: prepaid > 0 ? prepaid : undefined,
    };
    res.legal_monetary_total = legalMonetaryTotal;

    // 11. Dynamic Placeholder Replacement (All tokens turned to ALL CAPS)
    const placeholderContext: PlaceholderContext = {
      authContext,
      irn: typeof res.irn === "string" ? res.irn : "",
      invoiceRef: invoiceRef || "INV-SAMPLE",
      issueDate: String(res.issue_date),
      issueTime: String(res.issue_time),
    };
    res = this.replacePlaceholders(res, placeholderContext);

    // 12. Check for remaining missing fields against schema
    const missing: string[] = [];
    if (firsSchema) {
      for (const field of firsSchema) {
        const rules = (field.validation_rules as unknown as string[]) || [];
        const isReq = field.is_required || rules.includes("required");
        if (!isReq) continue;
        const path = (field.field_path || "").trim();
        if (!path) continue;
        const val = this.getDeepValue(res, path);
        if (val === undefined || val === null || val === "") {
          missing.push(path);
        }
      }
    }

    return {
      completedData: res as unknown as FIRSInvoice,
      isFullyCompliant: missing.length === 0,
      missingFields: missing,
      mathHealed,
      adjustmentsMade: adjustments,
    };
  }

  /**
   * Resolve any token normalized to ALL CAPS into dynamic context values
   */
  static resolveTokenValue(token: string, context: PlaceholderContext): string {
    const capsToken = token.trim().toUpperCase();
    switch (capsToken) {
      case "IRN":
        return context.irn || "";

      case "BUSINESS_ID":
        return context.authContext?.businessId || "BUS-DEFAULT-01";

      case "TENANT_ID":
        return (
          context.authContext?.tenantId ||
          "37c9da19-f917-48a0-842c-a963feed9010"
        );

      case "SUPPLIER_TIN":
      case "BUSINESS_TIN":
      case "TIN":
        return context.authContext?.businessTIN || "00364075-0001";

      case "SUPPLIER_NAME":
      case "BUSINESS_NAME":
      case "COMPANY_NAME":
        return context.authContext?.businessName || "Heirs Technologies HQ";

      case "SUPPLIER_EMAIL":
      case "BUSINESS_EMAIL":
      case "EMAIL":
        return context.authContext?.email || "finance@heirstechnologies.com";

      case "SUPPLIER_PHONE":
      case "SUPPLIER_TEL":
      case "PHONE":
      case "TELEPHONE":
        return (
          (context.authContext as any)?.telephone ||
          (context.authContext as any)?.phone ||
          "+2348000000000"
        );

      case "SERVICE_ID":
        return context.authContext?.serviceId || "";

      case "ISSUE_DATE":
        return context.issueDate || new Date().toISOString().split("T")[0];

      case "ISSUE_TIME":
        return context.issueTime || new Date().toTimeString().slice(0, 8);

      case "INVOICE_REF":
        return context.invoiceRef || "";

      default:
        // Also check if authContext has this property (case-insensitive)
        if (context.authContext) {
          const authKey = Object.keys(context.authContext).find(
            (k) => k.toUpperCase() === capsToken,
          );
          if (authKey && (context.authContext as any)[authKey] !== undefined) {
            return String((context.authContext as any)[authKey]);
          }
        }
        return `{{${capsToken}}}`;
    }
  }

  /**
   * Recursively replace any {{TOKEN}} placeholders in objects, arrays, and strings,
   * converting tokens to ALL CAPS for case-insensitive lookup.
   */
  static replacePlaceholders<T = any>(data: T, context: PlaceholderContext): T {
    if (data == null) return data;

    if (typeof data === "string") {
      if (!data.includes("{{")) return data;

      // Single exact placeholder match: e.g. "{{irn}}" or "{{IRN}}"
      const exactMatch = data.trim().match(/^\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}$/);
      if (exactMatch) {
        const token = exactMatch[1].trim().toUpperCase();
        return this.resolveTokenValue(token, context) as unknown as T;
      }

      // Embedded placeholders: e.g. "INV-{{irn}}"
      return data.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, rawToken) => {
        const token = String(rawToken).trim().toUpperCase();
        return this.resolveTokenValue(token, context);
      }) as unknown as T;
    }

    if (Array.isArray(data)) {
      return data.map((item) =>
        this.replacePlaceholders(item, context),
      ) as unknown as T;
    }

    if (typeof data === "object") {
      const res: Record<string, any> = {};
      for (const [k, v] of Object.entries(data)) {
        res[k] = this.replacePlaceholders(v, context);
      }
      return res as unknown as T;
    }

    return data;
  }
}
