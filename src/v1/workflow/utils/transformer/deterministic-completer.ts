import { AuthContext } from "../../../../middlewares";
import { ISchemaField } from "../../models";
import {
  extractCurrency,
  generateInvoiceRef,
  generateIRN,
  resolveCurrencyCode,
  sanitizePriceUnit,
} from "./utils";
import { ensureBusinessDescription } from "../invoice-sanitizer.util";

export interface ReconcileResult {
  completedData: Record<string, any>;
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
   * Traverses object to get nested value safely
   */
  static getDeepValue(obj: unknown, path: string): unknown {
    if (!path || typeof path !== "string" || !obj || typeof obj !== "object") return undefined;
    const keys = path
      .replace(/\[(\d+|\*)\]/g, ".$1")
      .split(".")
      .filter(Boolean);

    let current: any = obj;
    for (const key of keys) {
      if (current == null || typeof current !== "object") return undefined;
      if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
      current = current[key];
    }
    return current;
  }

  /**
   * Sets nested value safely
   */
  static setDeepValue(obj: Record<string, any>, path: string, value: unknown): void {
    if (!obj || typeof obj !== "object" || !path || typeof path !== "string") return;
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
    if (last === "__proto__" || last === "constructor" || last === "prototype") {
      throw new Error("Prototype pollution attempt detected");
    }
    current[last] = value;
  }

  /**
   * Fully reconciles and auto-completes an invoice payload deterministically
   */
  static reconcileAndComplete(
    data: Record<string, any>,
    authContext?: AuthContext,
    firsSchema?: ISchemaField[],
    currencies: any[] = [],
  ): ReconcileResult {
    const res: Record<string, any> = { ...data };
    const adjustments: string[] = [];
    let mathHealed = false;

    // Address & Email Defaults Helpers
    const defaultAddress = (given: any = {}) => ({
      street_name: given.street_name || given.street || "1 Commercial Way",
      city_name: given.city_name || given.city || "Lagos",
      postal_zone: given.postal_zone || given.zip || "100001",
      country: given.country || "NG",
      state: given.state || "Lagos",
    });

    const defaultEmail = (given: string = "", fallback: string = "info@company.com") => {
      if (typeof given === "string" && given.includes("@")) return given.trim();
      return fallback;
    };

    // 1. Identity & Supplier Information
    const expectedBusinessId = authContext?.businessId || res.business_id || "TEST_BUSINESS_ID";
    const expectedSupplierTIN = authContext?.businessTIN || res.supplier_tin || "10000000-0001";
    const expectedSupplierName = authContext?.businessName || (authContext as any)?.tenantName || "Supplier Company Inc";

    res.business_id = expectedBusinessId;

    if (!res.accounting_supplier_party || typeof res.accounting_supplier_party !== "object") {
      res.accounting_supplier_party = {};
    }
    const supplier = res.accounting_supplier_party as Record<string, any>;
    supplier.tin = expectedSupplierTIN;
    supplier.party_name = supplier.party_name || supplier.name || expectedSupplierName;
    supplier.name = supplier.party_name;
    supplier.email = defaultEmail(supplier.email, "supplier@business.com");
    // FIRS requires businessdescription to be at least 5 characters on both
    // parties. Nothing upstream supplies one, so derive it from the party name.
    supplier.business_description = ensureBusinessDescription(
      supplier,
      supplier.party_name,
    );
    supplier.postal_address = defaultAddress(supplier.postal_address);

    // 2. Customer Party Auto-Completion
    if (!res.accounting_customer_party || typeof res.accounting_customer_party !== "object") {
      res.accounting_customer_party = {};
    }
    const customer = res.accounting_customer_party as Record<string, any>;
    let custName = customer.party_name || customer.name;
    if (!custName) {
      if (typeof res.customer_name === "string" && res.customer_name.trim()) {
        custName = res.customer_name.trim();
      } else if (typeof res.buyer_name === "string" && res.buyer_name.trim()) {
        custName = res.buyer_name.trim();
      } else {
        custName = "General Customer";
        adjustments.push("Defaulted customer party_name to General Customer");
      }
    }
    customer.party_name = custName;
    customer.name = custName;

    if (!customer.tin) {
      if (typeof res.customer_tin === "string" && res.customer_tin.trim()) {
        customer.tin = res.customer_tin.trim();
      } else if (typeof res.buyer_tin === "string" && res.buyer_tin.trim()) {
        customer.tin = res.buyer_tin.trim();
      } else {
        customer.tin = "00000000-0000";
      }
    }
    customer.email = defaultEmail(customer.email, "customer@domain.com");
    customer.business_description = ensureBusinessDescription(
      customer,
      customer.party_name,
    );
    customer.postal_address = defaultAddress(customer.postal_address);

    // 3. IRN & Invoice Reference Resolution
    let invoiceRef = "";
    if (typeof res.invoice_reference === "string" && res.invoice_reference.trim()) {
      invoiceRef = res.invoice_reference.trim();
    } else if (typeof res.invoiceNumber === "string" && res.invoiceNumber.trim()) {
      invoiceRef = res.invoiceNumber.trim();
    } else if (typeof res.invoice_id === "string" && res.invoice_id.trim()) {
      invoiceRef = res.invoice_id.trim();
    } else {
      invoiceRef = generateInvoiceRef();
    }
    res.invoice_reference = invoiceRef;

    if (!res.irn) {
      const serviceId = authContext?.serviceId || "34A843BE";
      res.irn = generateIRN(invoiceRef, serviceId);
      adjustments.push("Auto-generated IRN");
    }

    // 4. Dates & Times
    if (!res.issue_date || typeof res.issue_date !== "string" || !res.issue_date.trim()) {
      res.issue_date = new Date().toISOString().slice(0, 10);
      adjustments.push("Defaulted issue_date to current date");
    }
    if (!res.issue_time || typeof res.issue_time !== "string" || !res.issue_time.trim()) {
      res.issue_time = new Date().toTimeString().slice(0, 8);
      adjustments.push("Defaulted issue_time to current time");
    }

    // 5. Invoice Type Code & Kind
    if (!res.invoice_type_code) {
      res.invoice_type_code = res.invoiceTypeCode || "396";
    }
    if (!res.invoice_kind) {
      res.invoice_kind = res.invoiceKind || "B2B";
    }

    // 6. Currencies
    const docCurr = extractCurrency(res, "document", currencies) || "NGN";
    res.document_currency_code = resolveCurrencyCode(docCurr, currencies);
    const taxCurr = extractCurrency(res, "tax", currencies) || res.document_currency_code;
    res.tax_currency_code = resolveCurrencyCode(taxCurr, currencies);

    // 7. Payment Status & Payment Means
    if (!res.payment_status) {
      res.payment_status = "PENDING";
    }
    if (!res.payment_means || !Array.isArray(res.payment_means)) {
      if (res.payment_means && typeof res.payment_means === "object") {
        res.payment_means = [res.payment_means];
      } else {
        res.payment_means = [
          {
            payment_means_code: "10",
            payee_financial_account: {
              account_number: "0000000000",
              account_name: supplier.party_name || "Default Company Account",
              bank_name: "Central Bank of Nigeria",
            },
          },
        ];
        adjustments.push("Auto-populated default payment_means array");
      }
    }

    // 8. Line Items Normalization & Mathematical Reconciliation
    let rawLines: any[] = [];
    if (Array.isArray(res.invoice_line) && res.invoice_line.length > 0) rawLines = res.invoice_line;
    else if (Array.isArray(res.invoiceLine) && res.invoiceLine.length > 0) rawLines = res.invoiceLine;
    else if (Array.isArray(res.line_items) && res.line_items.length > 0) rawLines = res.line_items;
    else if (Array.isArray(res.invoice?.line_items) && res.invoice.line_items.length > 0) rawLines = res.invoice.line_items;
    else if (Array.isArray(res.items) && res.items.length > 0) rawLines = res.items;
    else if (Array.isArray(res.lines) && res.lines.length > 0) rawLines = res.lines;
    else if (Array.isArray(res.invoice_line)) rawLines = res.invoice_line;

    let computedLineExtensionTotal = 0;
    const normalizedLines: any[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] || {};
      const itemRaw = raw.item && typeof raw.item === "object" ? raw.item : {};
      const priceRaw = raw.price && typeof raw.price === "object" ? raw.price : {};

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
        adjustments.push(`Line ${i + 1}: Back-calculated price_amount from line total`);
      }

      computedLineExtensionTotal += lineAmount;

      const itemName = (itemRaw.name || raw.name || raw.description || `Item ${i + 1}`).trim();
      const itemDesc = (itemRaw.description || raw.description || itemName).trim();
      const category = (raw.product_category || raw.service_category || itemName || "General Goods and Services").trim();

      const rawUnit = String(priceRaw.price_unit || raw.unit || "H87").trim();
      const priceUnit = sanitizePriceUnit(rawUnit);

      normalizedLines.push({
        hsn_code: raw.hsn_code ? String(raw.hsn_code).trim() : undefined,
        isic_code: raw.isic_code ? String(raw.isic_code).trim() : undefined,
        product_category: category,
        invoiced_quantity: qty,
        line_extension_amount: lineAmount,
        item: {
          name: itemName,
          description: itemDescription(itemDesc),
          sellers_item_identification: itemRaw.sellers_item_identification
            ? String(itemRaw.sellers_item_identification).trim()
            : undefined,
        },
        price: {
          price_amount: priceAmount,
          base_quantity: baseQty,
          price_unit: priceUnit,
        },
        discount_rate: raw.discount_rate !== undefined ? this.toFloat(raw.discount_rate) : undefined,
        discount_amount: raw.discount_amount !== undefined ? this.toFloat(raw.discount_amount) : undefined,
        fee_rate: raw.fee_rate !== undefined ? this.toFloat(raw.fee_rate) : undefined,
        fee_amount: raw.fee_amount !== undefined ? this.toFloat(raw.fee_amount) : undefined,
      });
    }

    function itemDescription(d: string): string {
      return d.length > 0 ? d : "Item Description";
    }

    if (normalizedLines.length === 0) {
      normalizedLines.push({
        product_category: "General Goods and Services",
        invoiced_quantity: 1,
        line_extension_amount: 0,
        item: { name: "General Item", description: "General Item Description" },
        price: { price_amount: 0, base_quantity: 1, price_unit: "H87" },
      });
      adjustments.push("Created default fallback invoice_line");
    }

    res.invoice_line = normalizedLines;

    // 9. Tax Total Calculation & Auto-Categorization
    let totalTaxAmount = 0;
    if (Array.isArray(res.tax_total) && res.tax_total.length > 0) {
      for (const tt of res.tax_total) {
        if (!tt) continue;
        tt.tax_amount = this.toFloat(tt.tax_amount);
        totalTaxAmount += tt.tax_amount;
        if (Array.isArray(tt.tax_subtotal)) {
          for (const st of tt.tax_subtotal) {
            if (!st) continue;
            st.taxable_amount = this.toFloat(st.taxable_amount, computedLineExtensionTotal);
            st.tax_amount = this.toFloat(st.tax_amount);
            if (!st.tax_category || typeof st.tax_category !== "object") {
              st.tax_category = {};
            }
            const pct = this.toFloat(st.tax_category.percent, 7.5);
            st.tax_category.percent = pct;
            if (!st.tax_category.id || typeof st.tax_category.id !== "string") {
              st.tax_category.id = pct === 0 ? "ZERO_VAT" : "STANDARD_VAT";
            }
          }
        }
      }
    } else {
      const estimatedVat = computedLineExtensionTotal * 0.075;
      totalTaxAmount = estimatedVat;
      res.tax_total = [
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
      adjustments.push("Auto-computed 7.5% STANDARD_VAT tax_total subtotal structure");
    }

    // 10. Legal Monetary Total Mathematical Reconciliation
    if (!res.legal_monetary_total || typeof res.legal_monetary_total !== "object") {
      res.legal_monetary_total = {};
    }
    const lmt = res.legal_monetary_total as Record<string, any>;
    const rawLineExt = this.toFloat(lmt.line_extension_amount, 0);
    const lineExt = rawLineExt > 0 ? rawLineExt : computedLineExtensionTotal;

    const rawTaxExcl = this.toFloat(lmt.tax_exclusive_amount, 0);
    const taxExcl = rawTaxExcl > 0 ? rawTaxExcl : lineExt;

    const rawTaxIncl = this.toFloat(lmt.tax_inclusive_amount, 0);
    const taxIncl = rawTaxIncl > 0 ? rawTaxIncl : (taxExcl + totalTaxAmount);

    const prepaid = this.toFloat(lmt.prepaid_amount, 0);

    const rawPayable = this.toFloat(lmt.payable_amount, 0);
    const payable = rawPayable > 0 ? rawPayable : (taxIncl - prepaid);

    if (lmt.payable_amount !== payable || lmt.line_extension_amount !== lineExt) {
      mathHealed = true;
      adjustments.push("Reconciled legal_monetary_total mathematical totals");
    }

    lmt.line_extension_amount = lineExt;
    lmt.tax_exclusive_amount = taxExcl;
    lmt.tax_inclusive_amount = taxIncl;
    lmt.prepaid_amount = prepaid;
    lmt.payable_amount = payable;

    // 11. Check for remaining missing fields against schema
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
      completedData: res,
      isFullyCompliant: missing.length === 0,
      missingFields: missing,
      mathHealed,
      adjustmentsMade: adjustments,
    };
  }
}
