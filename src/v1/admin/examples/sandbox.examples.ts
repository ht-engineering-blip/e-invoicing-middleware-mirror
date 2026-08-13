import { faker } from "@faker-js/faker";

// ── Primitives ──────────────────────────────────────────────────────────────

const amount = parseFloat(
  faker.number
    .float({ min: 50000, max: 1300000, fractionDigits: 2 })
    .toFixed(2),
);
const vat = parseFloat((amount * 0.075).toFixed(2));
const total = parseFloat((amount + vat).toFixed(2));

const supplierTin = `${faker.number.int({ min: 10000000, max: 99999999 })}-0001`;
const buyerTin = `${faker.number.int({ min: 10000000, max: 99999999 })}-0001`;

const issueDate = faker.date.recent({ days: 30 }).toISOString().split("T")[0];
const dueDate = faker.date.soon({ days: 30 }).toISOString().split("T")[0];

const sampleServiceId = faker.string.alphanumeric(8).toUpperCase();
const irn = `INV${faker.number.int({ min: 1000, max: 9999 })}-${sampleServiceId}-${issueDate.replace(/-/g, "")}`;

// ── Full FIRS-compliant invoice payload ─────────────────────────────────────

/**
 * Sample invoice that matches the full FIRS UBL schema.
 * Used as the default example in the Scalar/OpenAPI docs.
 * All fields follow UBL standard as required by FIRS NRS.
 */
const sampleInvoice = {
  // ── Core identifiers ────────────────────────────────────────────────────
  business_id: "8f8b8e88-6b83-4a34-934d-1a8684bb57f2",
  irn,
  invoice_number: `INV-${faker.number.int({ min: 1000, max: 9999 })}`,
  issue_date: issueDate,
  due_date: dueDate,
  issue_time: "17:59:04",
  invoice_type_code: "380", // 380=Commercial invoice, 381=Credit note, 396=Debit note
  invoice_kind: "B2B", // B2B | B2C | B2G
  document_currency_code: "NGN",
  tax_currency_code: "NGN",
  payment_status: "PENDING",
  note: "Payment due within 30 days of invoice issue.",

  // ── Supplier (1.22) ──────────────────────────────────────────────────────
  accounting_supplier_party: {
    party_name: "Heirs Technologies", // 1.22.1
    tin: supplierTin, // 1.22.2  e.g. "24058123-0001"
    email: "supplier_business@email.com", // 1.22.3
    telephone: "+2348025409900", // 1.22.4  must start with "+"
    business_description: "Technology and financial services provider", // 1.22.5
    postal_address: {
      // 1.22.6
      street_name: "10, Banana Island Road", // 1.22.7
      city_name: "Ikeja", // 1.22.8
      postal_zone: "023041", // 1.22.9
      lga: "NG-LA-IKJ", // 1.22.10
      state: "NG-LA", // 1.22.11
      country: "NG", // 1.22.12  ISO 3166-1 Alpha-2
    },
  },

  // ── Customer (1.23) ──────────────────────────────────────────────────────
  accounting_customer_party: {
    party_name: "Dangote Group",
    tin: buyerTin,
    email: "business@email.com",
    telephone: "+2348025400000",
    business_description: "Cement and building materials",
    postal_address: {
      street_name: "32, Owonikoko Street",
      city_name: "Gwarikpa",
      postal_zone: "023401",
      lga: "NG-AB-ANO",
      state: "NG-AB",
      country: "NG",
    },
  },

  // ── Tax Total (1.3) ──────────────────────────────────────────────────────
  tax_total: [
    {
      tax_amount: vat, // 1.3.1
      tax_subtotal: [
        // 1.3.2
        {
          taxable_amount: amount,
          tax_amount: vat,
          tax_category: {
            id: "STANDARD_VAT", // STANDARD_VAT | ZERO_VAT | REDUCED_VAT
            percent: 7.5,
          },
        },
      ],
    },
  ],

  // ── Legal Monetary Total (1.36) ──────────────────────────────────────────
  legal_monetary_total: {
    line_extension_amount: amount, // 1.36.1 total before tax & discounts
    tax_exclusive_amount: amount, // 1.36.2 total before tax
    tax_inclusive_amount: total, // 1.36.3 total after tax
    payable_amount: total, // 1.36.4 final amount to pay
  },

  // ── Invoice Lines (1.41) ─────────────────────────────────────────────────
  invoice_line: [
    {
      // Goods line: use hsn_code + product_category
      hsn_code: "1006.30", // 1.41.1  WCO HS code for rice
      product_category: "Food and Beverages", // 1.41.2
      discount_rate: 5, // 1.41.5  % discount
      discount_amount: 2500, // 1.41.6  discount in NGN
      fee_rate: 2, // 1.41.7  % fee
      fee_amount: 450, // 1.41.8  fee in NGN
      invoiced_quantity: 15, // 1.41.9
      line_extension_amount: amount, // 1.41.10 line total before tax
      item: {
        // 1.41.11
        name: "50kg Bag of Rice",
        description: "Premium long-grain rice",
        sellers_item_identification: "Rice-50KG-001",
      },
      price: {
        // 1.41.12
        price_amount: 5000,
        base_quantity: 1,
        price_unit: "XBG", // UN/ECE unit code: XBG=bag
      },
    },
    {
      // Service line: use isic_code + service_category (no hsn_code)
      isic_code: "6201", // 1.41.3  ISIC code for software activities
      service_category: "Computer programming activities", // 1.41.4
      discount_rate: 0,
      discount_amount: 0,
      fee_rate: 0,
      fee_amount: 0,
      invoiced_quantity: 1,
      line_extension_amount: 150000,
      item: {
        name: "Software Integration Service",
        description: "ERP-to-FIRS integration and testing",
        sellers_item_identification: "SVC-INTG-001",
      },
      price: {
        price_amount: 150000,
        base_quantity: 1,
        price_unit: "H87", // UN/ECE unit code: H87=piece/each
      },
    },
  ],
};

// ── Per-endpoint examples ────────────────────────────────────────────────────

export const testTransformExample = {
  erpType: "ODOO",
  invoice: sampleInvoice,
};

export const testValidateExample = {
  invoice: sampleInvoice,
};

export const testFullExample = {
  erpType: "ODOO",
  invoice: sampleInvoice,
};
