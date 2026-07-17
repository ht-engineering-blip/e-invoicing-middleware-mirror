import { faker } from "@faker-js/faker";
import { FIRS_SCHEMA_EXAMPLE } from "../../workflow/utils/transformer/utils";

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
  ...JSON.parse(FIRS_SCHEMA_EXAMPLE),
  irn: SAMPLE_IRN,
  issue_date: SAMPLE_ISSUE_DATE,

  issue_time: SAMPLE_ISSUE_TIME,

  payment_status: "PENDING",
  due_date: SAMPLE_DUE_DATE,
  business_id: SAMPLE_BUSINESS_ID,
  invoice_type_code: "380",
  invoice_kind: SAMPLE_INVOICE_KIND,
  document_currency_code: "NGN",
  tax_currency_code: "NGN",
  accounting_supplier_party: {
    party_name: "Heirs Technologies",
    party_tax_scheme: { company_id: SAMPLE_SUPPLIER_TIN },
    postal_address: {
      street_name: faker.location.streetAddress(),
      city_name: faker.location.city(),
      country: { identification_code: "NG" },
    },
  },
  accounting_customer_party: {
    party_name: faker.company.name(),
    party_tax_scheme: { company_id: SAMPLE_BUYER_TIN },
    postal_address: {
      street_name: faker.location.streetAddress(),
      city_name: faker.location.city(),
      country: { identification_code: "NG" },
    },
  },
  invoice_lines: [
    {
      id: "1",
      hsn_code: "1282.10",
      isic_code: "4100",
      product_category: "Computer Hardware",
      service_category: "Information Security",

      invoiced_quantity: faker.number.int({ min: 1, max: 10 }),
      line_extension_amount: SAMPLE_AMOUNT,
      item: {
        description: faker.commerce.productName(),
        sellers_item_identification: faker.string.alphanumeric(8),
      },
      price: {
        price_amount: SAMPLE_AMOUNT,
        base_quantity: 1,
        price_unit: "H87",
      },
      tax_total: {
        tax_amount: SAMPLE_VAT,
        tax_subtotals: [
          {
            taxable_amount: SAMPLE_AMOUNT,
            tax_amount: SAMPLE_VAT,
            tax_category: { id: "VAT", percent: 7.5 },
          },
        ],
      },
    },
  ],
  tax_total: { tax_amount: SAMPLE_VAT },
  legal_monetary_total: {
    line_extension_amount: SAMPLE_AMOUNT,
    tax_exclusive_amount: SAMPLE_AMOUNT,
    tax_inclusive_amount: SAMPLE_TOTAL,
    payable_amount: SAMPLE_TOTAL,
  },
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
