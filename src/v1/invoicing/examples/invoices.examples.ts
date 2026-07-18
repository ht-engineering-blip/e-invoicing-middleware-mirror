import { faker } from "@faker-js/faker";

// ── Primitives ────────────────────────────────────────────────────────────────

export const SAMPLE_IRN = `${faker.string.alphanumeric(6).toUpperCase()}-${faker.string.alphanumeric(8).toUpperCase()}-${faker.date.recent().toISOString().split("T")[0].replace(/-/g, "")}`;
export const SAMPLE_INVOICE_NUMBER = `INV-${faker.number.int({ min: 1000, max: 9999 })}`;
export const SAMPLE_ISSUE_DATE = faker.date
  .recent({ days: 30 })
  .toISOString()
  .split("T")[0];
export const SAMPLE_ISSUE_TIME = faker.date
  .recent({ days: 30 })
  .toISOString()
  .split("T")[1];
export const SAMPLE_DUE_DATE = faker.date
  .soon({ days: 30 })
  .toISOString()
  .split("T")[0];
export const SAMPLE_SUPPLIER_TIN = `${faker.number.int({ min: 10000000, max: 99999999 })}-0001`;
export const SAMPLE_BUYER_TIN = `${faker.number.int({ min: 10000000, max: 99999999 })}-0001`;
export const SAMPLE_AMOUNT = faker.number.float({
  min: 10000,
  max: 500000,
  fractionDigits: 2,
});
export const SAMPLE_VAT = parseFloat((SAMPLE_AMOUNT * 0.075).toFixed(2));
export const SAMPLE_TOTAL = parseFloat((SAMPLE_AMOUNT + SAMPLE_VAT).toFixed(2));
export const SAMPLE_PAYMENT_REF = `TRF-${faker.date.recent().toISOString().split("T")[0].replace(/-/g, "")}-${faker.string.alphanumeric(6).toUpperCase()}`;
export const SAMPLE_BUSINESS_ID = "8f8b8e88-6b83-4a34-934d-1a8684bb57f2";
export const SAMPLE_INVOICE_KIND = `B2B`;

// ── Invoice body (shared across transform / validate / sign) ──────────────────

export const SAMPLE_INVOICE_BODY = {
  business_id: SAMPLE_BUSINESS_ID,
  irn: SAMPLE_IRN,
  issue_date: SAMPLE_ISSUE_DATE,
  due_date: SAMPLE_DUE_DATE,
  issue_time: "17:59:04",
  invoice_type_code: "396",
  invoice_kind: SAMPLE_INVOICE_KIND,
  payment_status: "PENDING",
  note: "This invoice includes a 5% discount.",
  tax_point_date: SAMPLE_ISSUE_DATE,
  document_currency_code: "NGN",
  tax_currency_code: "NGN",
  accounting_cost: "2000",
  buyer_reference: "ITW001-E9E0C0D3-20240619",
  invoice_delivery_period: {
    start_date: SAMPLE_ISSUE_DATE,
    end_date: SAMPLE_DUE_DATE,
  },
  order_reference: "ITW001-E9E0C0D3-20240619",
  billing_reference: [
    {
      irn: "ITW001-E9E0C0D3-20240619",
      issue_date: SAMPLE_ISSUE_DATE,
    },
  ],
  dispatch_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: SAMPLE_ISSUE_DATE,
  },
  receipt_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: SAMPLE_ISSUE_DATE,
  },
  originator_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: SAMPLE_ISSUE_DATE,
  },
  contract_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: SAMPLE_ISSUE_DATE,
  },
  additional_document_reference: [
    {
      irn: "ITW001-E9E0C0D3-20240619",
      issue_date: SAMPLE_ISSUE_DATE,
    },
  ],
  accounting_supplier_party: {
    party_name: "Heirs Technologies",
    tin: SAMPLE_SUPPLIER_TIN,
    email: "supplier_business@email.com",
    telephone: "+23480254099000",
    business_description: "Technology and financial services",
    postal_address: {
      street_name: "32, owonikoko street",
      city_name: "Gwarikpa",
      postal_zone: "023401",
      lga: "NG-AB-ANO",
      state: "NG-AB",
      country: "NG",
    },
  },
  accounting_customer_party: {
    party_name: "Dangote Group",
    tin: SAMPLE_BUYER_TIN,
    email: "business@email.com",
    telephone: "+23480254000000",
    business_description: "Cement and building materials",
    postal_address: {
      street_name: "32, owonikoko street",
      city_name: "Gwarikpa",
      postal_zone: "023401",
      lga: "NG-AB-ANO",
      state: "NG-AB",
      country: "NG",
    },
  },
  actual_delivery_date: SAMPLE_ISSUE_DATE,
  payment_means: [
    {
      payment_means_code: "10",
      payment_due_date: SAMPLE_ISSUE_DATE,
    },
  ],
  payment_terms_note: "Payment due within 30 days of invoice issue.",
  allowance_charge: [
    {
      charge_indicator: true,
      amount: 800.6,
    },
    {
      charge_indicator: false,
      amount: 10,
    },
  ],
  tax_total: [
    {
      tax_amount: 56.07,
      tax_subtotal: [
        {
          taxable_amount: 800,
          tax_amount: 56.07,
          tax_category: {
            id: "STANDARD_VAT",
            percent: 7.5,
          },
        },
      ],
    },
  ],
  legal_monetary_total: {
    line_extension_amount: SAMPLE_AMOUNT,
    tax_exclusive_amount: SAMPLE_AMOUNT,
    tax_inclusive_amount: SAMPLE_TOTAL,
    payable_amount: SAMPLE_TOTAL,
  },
  invoice_line: [
    {
      hsn_code: "1006.30",
      product_category: "Cereals; rice, semi-milled or wholly milled, whether or not polished or glazed",
      discount_rate: 2.01,
      discount_amount: 0.603,
      fee_rate: 1.01,
      fee_amount: 50,
      invoiced_quantity: 15,
      line_extension_amount: SAMPLE_AMOUNT,
      item: {
        name: "item name",
        description: "item description",
        sellers_item_identification: "identified as spoon by the seller",
      },
      price: {
        price_amount: 10,
        base_quantity: 3,
        price_unit: "XBG",
      },
    },
    {
      isic_code: "0112",
      service_category: "Growing of rice",
      discount_rate: 2.01,
      discount_amount: 0.603,
      fee_rate: 1.01,
      fee_amount: 50,
      invoiced_quantity: 15,
      line_extension_amount: SAMPLE_AMOUNT,
      item: {
        name: "item name 2",
        description: "item description 2",
        sellers_item_identification: "identified as shovel by the seller",
      },
      price: {
        price_amount: 20,
        base_quantity: 5,
        price_unit: "XBG",
      },
    },
  ],
};

// ── Per-endpoint examples ─────────────────────────────────────────────────────

export const generateIrnExample = {
  invoiceNumber: SAMPLE_INVOICE_NUMBER,
  issueDate: SAMPLE_ISSUE_DATE,
};

export const irnOnlyExample = { irn: SAMPLE_IRN };

export const acknowledgeExample = {
  irn: SAMPLE_IRN,
  message: "Invoice received and acknowledged.",
};

export const statusUpdateExample = {
  status: "PAID",
  paymentDate: SAMPLE_ISSUE_DATE,
  paymentAmount: SAMPLE_TOTAL,
  paymentReference: SAMPLE_PAYMENT_REF,
};

export const vatReportExample = {
  agent_tin: SAMPLE_SUPPLIER_TIN,
  base_amount: String(SAMPLE_AMOUNT),
  beneficiary_tin: SAMPLE_BUYER_TIN,
  currency: "NGN",
  item_description: "Professional Consulting Services",
  irn: SAMPLE_IRN,
  other_taxes: "0.00",
  total_amount: String(SAMPLE_TOTAL),
  transaction_date: SAMPLE_ISSUE_DATE,
  vat_calculated: String(SAMPLE_VAT),
  vat_rate: "7.5",
  vat_status: "STANDARD_VAT",
};
