import type { FIRSInvoice } from "./schema-validator";
import {
  generateDatestamp,
  generateInvoiceRef,
  generateIRN,
  sanitizeInvoiceIRNs,
  sanitizePriceUnit,
} from "./utils";
import { AuthContext } from "../../../../middlewares";

export interface InvoiceLineItem {
  hsn_code?: string;
  isic_code?: string;
  product_category?: string;
  service_category?: string;
  invoiced_quantity: number;
  line_extension_amount: number;
  item: {
    name: string;
    description: string;
    sellers_item_identification?: string;
  };
  price: {
    price_amount: number;
    base_quantity: number;
    price_unit: string;
  };
  discount_rate?: number;
  discount_amount?: number;
  fee_rate?: number;
  fee_amount?: number;
}

export function normalizeInvoicePayload(
  invoice: Record<string, unknown>,
  authContext?: AuthContext,
): Partial<FIRSInvoice> {
  const today = generateDatestamp();
  const rawInvoice = { ...invoice };

  // 1. Sanitize IRNs and References
  sanitizeInvoiceIRNs(rawInvoice);

  // 2. Resolve Business ID
  let businessId = "{{TEST_BUSINESS_ID}}";
  if (authContext && authContext.businessId) {
    businessId = authContext.businessId;
  } else if (
    typeof rawInvoice.business_id === "string" &&
    rawInvoice.business_id.trim() !== ""
  ) {
    businessId = rawInvoice.business_id.trim();
  }

  // 3. Resolve Effective Service ID and IRN
  let effectiveServiceId: string | undefined = undefined;
  if (authContext && authContext.serviceId) {
    effectiveServiceId = authContext.serviceId;
  } else if (authContext && authContext.businessId) {
    effectiveServiceId = authContext.businessId.slice(0, 8);
  }

  let irn = "";
  if (typeof rawInvoice.irn === "string" && rawInvoice.irn.trim() !== "") {
    irn = rawInvoice.irn.trim();
  } else if (effectiveServiceId) {
    let invoiceReference = "";
    if (
      typeof rawInvoice.invoice_reference === "string" &&
      rawInvoice.invoice_reference.trim() !== ""
    ) {
      invoiceReference = rawInvoice.invoice_reference.trim();
    } else if (
      typeof rawInvoice.invoiceNumber === "string" &&
      rawInvoice.invoiceNumber.trim() !== ""
    ) {
      invoiceReference = rawInvoice.invoiceNumber.trim();
    } else {
      invoiceReference = generateInvoiceRef();
    }

    const generated = generateIRN(invoiceReference, effectiveServiceId);

    if (generated) irn = generated;
  }

  // 4. Resolve Issue Date
  let issueDate = "";
  if (
    typeof rawInvoice.issue_date === "string" &&
    rawInvoice.issue_date.trim() !== ""
  ) {
    issueDate = rawInvoice.issue_date.trim();
  } else {
    issueDate = new Date().toISOString().slice(0, 10);
  }

  // 5. Resolve Invoice Type Code
  let invoiceTypeCode = "396";
  if (
    typeof rawInvoice.invoice_type_code === "string" &&
    rawInvoice.invoice_type_code.trim() !== ""
  ) {
    invoiceTypeCode = rawInvoice.invoice_type_code.trim();
  } else if (
    typeof rawInvoice.invoiceTypeCode === "string" &&
    rawInvoice.invoiceTypeCode.trim() !== ""
  ) {
    invoiceTypeCode = rawInvoice.invoiceTypeCode.trim();
  }

  // 6. Resolve Invoice Kind
  let invoiceKind = "B2B";
  if (
    typeof rawInvoice.invoice_kind === "string" &&
    rawInvoice.invoice_kind.trim() !== ""
  ) {
    invoiceKind = rawInvoice.invoice_kind.trim();
  } else if (
    typeof rawInvoice.invoiceKind === "string" &&
    rawInvoice.invoiceKind.trim() !== ""
  ) {
    invoiceKind = rawInvoice.invoiceKind.trim();
  }

  // 7. Resolve Document & Tax Currency Codes
  let documentCurrencyCode = "NGN";
  if (
    typeof rawInvoice.document_currency_code === "string" &&
    rawInvoice.document_currency_code.trim() !== ""
  ) {
    documentCurrencyCode = rawInvoice.document_currency_code.trim();
  } else if (
    typeof rawInvoice.documentCurrencyCode === "string" &&
    rawInvoice.documentCurrencyCode.trim() !== ""
  ) {
    documentCurrencyCode = rawInvoice.documentCurrencyCode.trim();
  }

  let taxCurrencyCode = "NGN";
  if (
    typeof rawInvoice.tax_currency_code === "string" &&
    rawInvoice.tax_currency_code.trim() !== ""
  ) {
    taxCurrencyCode = rawInvoice.tax_currency_code.trim();
  } else if (
    typeof rawInvoice.taxCurrencyCode === "string" &&
    rawInvoice.taxCurrencyCode.trim() !== ""
  ) {
    taxCurrencyCode = rawInvoice.taxCurrencyCode.trim();
  } else {
    taxCurrencyCode = documentCurrencyCode;
  }

  // 8. Resolve Payment Status
  let paymentStatus = "PENDING";
  if (
    typeof rawInvoice.payment_status === "string" &&
    rawInvoice.payment_status.trim() !== ""
  ) {
    paymentStatus = rawInvoice.payment_status.trim();
  } else if (
    typeof rawInvoice.paymentStatus === "string" &&
    rawInvoice.paymentStatus.trim() !== ""
  ) {
    paymentStatus = rawInvoice.paymentStatus.trim();
  }

  // 9. Normalize Line Items with explicit if / else logic
  let rawLines: unknown[] = [];
  if (Array.isArray(rawInvoice.invoice_line)) {
    rawLines = rawInvoice.invoice_line;
  } else if (Array.isArray(rawInvoice.invoiceLine)) {
    rawLines = rawInvoice.invoiceLine;
  } else if (Array.isArray(rawInvoice.items)) {
    rawLines = rawInvoice.items;
  } else if (Array.isArray(rawInvoice.lines)) {
    rawLines = rawInvoice.lines;
  }

  const normalizedLines: InvoiceLineItem[] = rawLines.map((lineRaw) => {
    let line: Record<string, unknown> = {};
    if (lineRaw && typeof lineRaw === "object") {
      line = lineRaw as Record<string, unknown>;
    }

    let itemRaw: Record<string, unknown> = {};
    if (line.item && typeof line.item === "object") {
      itemRaw = line.item as Record<string, unknown>;
    }

    let priceRaw: Record<string, unknown> = {};
    if (line.price && typeof line.price === "object") {
      priceRaw = line.price as Record<string, unknown>;
    }

    // Invoiced Quantity
    let invoicedQty = 1;
    if (typeof line.invoiced_quantity === "number") {
      invoicedQty = line.invoiced_quantity;
    } else if (typeof line.quantity === "number") {
      invoicedQty = line.quantity;
    } else if (
      typeof line.invoiced_quantity === "string" &&
      !isNaN(Number(line.invoiced_quantity))
    ) {
      invoicedQty = Number(line.invoiced_quantity);
    } else if (
      typeof line.quantity === "string" &&
      !isNaN(Number(line.quantity))
    ) {
      invoicedQty = Number(line.quantity);
    }

    // Price Amount
    let priceAmount = 0;
    if (typeof priceRaw.price_amount === "number") {
      priceAmount = priceRaw.price_amount;
    } else if (typeof line.unit_price === "number") {
      priceAmount = line.unit_price;
    } else if (typeof line.price === "number") {
      priceAmount = line.price;
    } else if (
      typeof priceRaw.price_amount === "string" &&
      !isNaN(Number(priceRaw.price_amount))
    ) {
      priceAmount = Number(priceRaw.price_amount);
    } else if (
      typeof line.unit_price === "string" &&
      !isNaN(Number(line.unit_price))
    ) {
      priceAmount = Number(line.unit_price);
    } else if (typeof line.price === "string" && !isNaN(Number(line.price))) {
      priceAmount = Number(line.price);
    }

    // Base Quantity
    let baseQuantity = 1;
    if (
      typeof priceRaw.base_quantity === "number" &&
      priceRaw.base_quantity > 0
    ) {
      baseQuantity = priceRaw.base_quantity;
    } else if (
      typeof priceRaw.base_quantity === "string" &&
      !isNaN(Number(priceRaw.base_quantity)) &&
      Number(priceRaw.base_quantity) > 0
    ) {
      baseQuantity = Number(priceRaw.base_quantity);
    }

    // Line Extension Amount
    let lineAmount = (invoicedQty * priceAmount) / baseQuantity;
    if (typeof line.line_extension_amount === "number") {
      lineAmount = line.line_extension_amount;
    } else if (typeof line.total === "number") {
      lineAmount = line.total;
    } else if (
      typeof line.line_extension_amount === "string" &&
      !isNaN(Number(line.line_extension_amount))
    ) {
      lineAmount = Number(line.line_extension_amount);
    } else if (typeof line.total === "string" && !isNaN(Number(line.total))) {
      lineAmount = Number(line.total);
    }

    // Item Name
    let itemName = "Item";
    if (typeof itemRaw.name === "string" && itemRaw.name.trim() !== "") {
      itemName = itemRaw.name.trim();
    } else if (typeof line.name === "string" && line.name.trim() !== "") {
      itemName = line.name.trim();
    } else if (
      typeof line.description === "string" &&
      line.description.trim() !== ""
    ) {
      itemName = line.description.trim();
    }

    // Item Description
    let itemDescription = "Item description";
    if (
      typeof itemRaw.description === "string" &&
      itemRaw.description.trim() !== ""
    ) {
      itemDescription = itemRaw.description.trim();
    } else if (
      typeof line.description === "string" &&
      line.description.trim() !== ""
    ) {
      itemDescription = line.description.trim();
    } else if (typeof itemRaw.name === "string" && itemRaw.name.trim() !== "") {
      itemDescription = itemRaw.name.trim();
    } else if (typeof line.name === "string" && line.name.trim() !== "") {
      itemDescription = line.name.trim();
    }

    // Price Unit
    let rawPriceUnit = "H87";
    if (
      typeof priceRaw.price_unit === "string" &&
      priceRaw.price_unit.trim() !== ""
    ) {
      rawPriceUnit = priceRaw.price_unit.trim();
    } else if (typeof line.unit === "string" && line.unit.trim() !== "") {
      rawPriceUnit = line.unit.trim();
    }

    // HSN Code
    let hsnCode: string | undefined = undefined;
    if (typeof line.hsn_code === "string" && line.hsn_code.trim() !== "") {
      hsnCode = line.hsn_code.trim();
    }

    // ISIC Code
    let isicCode: string | undefined = undefined;
    if (typeof line.isic_code === "string" && line.isic_code.trim() !== "") {
      isicCode = line.isic_code.trim();
    }

    // Product Category
    let productCategory: string | undefined = undefined;
    if (
      typeof line.product_category === "string" &&
      line.product_category.trim() !== ""
    ) {
      productCategory = line.product_category.trim();
    }

    // Service Category
    let serviceCategory: string | undefined = undefined;
    if (
      typeof line.service_category === "string" &&
      line.service_category.trim() !== ""
    ) {
      serviceCategory = line.service_category.trim();
    }

    if (!productCategory) {
      productCategory =
        serviceCategory ||
        itemName ||
        itemDescription ||
        "General Goods and Services";
    }

    // Seller's Item Identification
    let sellersItemIdentification: string | undefined = undefined;
    if (
      typeof itemRaw.sellers_item_identification === "string" &&
      itemRaw.sellers_item_identification.trim() !== ""
    ) {
      sellersItemIdentification = itemRaw.sellers_item_identification.trim();
    }

    // Discount Rate
    let discountRate: number | undefined = undefined;
    if (typeof line.discount_rate === "number") {
      discountRate = line.discount_rate;
    }

    // Discount Amount
    let discountAmount: number | undefined = undefined;
    if (typeof line.discount_amount === "number") {
      discountAmount = line.discount_amount;
    }

    // Fee Rate
    let feeRate: number | undefined = undefined;
    if (typeof line.fee_rate === "number") {
      feeRate = line.fee_rate;
    }

    // Fee Amount
    let feeAmount: number | undefined = undefined;
    if (typeof line.fee_amount === "number") {
      feeAmount = line.fee_amount;
    }

    return {
      hsn_code: hsnCode,
      isic_code: isicCode,
      product_category: productCategory,
      service_category: serviceCategory,
      invoiced_quantity: invoicedQty,
      line_extension_amount: lineAmount,
      item: {
        name: itemName,
        description: itemDescription,
        sellers_item_identification: sellersItemIdentification,
      },
      price: {
        price_amount: priceAmount,
        base_quantity: baseQuantity,
        price_unit: sanitizePriceUnit(rawPriceUnit),
      },
      discount_rate: discountRate,
      discount_amount: discountAmount,
      fee_rate: feeRate,
      fee_amount: feeAmount,
    };
  });

  return {
    business_id: businessId,
    irn,
    issue_date: issueDate,
    invoice_type_code: invoiceTypeCode,
    invoice_kind: invoiceKind,
    document_currency_code: documentCurrencyCode,
    tax_currency_code: taxCurrencyCode,
    payment_status: paymentStatus,
    invoice_line: normalizedLines,
  };
}
