import { faker } from "@faker-js/faker";

const amount = faker.number.float({
  min: 5000,
  max: 200000,
  fractionDigits: 2,
});
const vat = parseFloat((amount * 0.075).toFixed(2));
const total = parseFloat((amount + vat).toFixed(2));
const supplierTin = `${faker.number.int({ min: 10000000, max: 99999999 })}-0001`;
const buyerTin = `${faker.number.int({ min: 10000000, max: 99999999 })}-0001`;
const issueDate = faker.date.recent({ days: 30 }).toISOString().split("T")[0];

const sampleInvoice = {
  invoice_number: `INV-${faker.number.int({ min: 1000, max: 9999 })}`,
  issue_date: issueDate,
  due_date: faker.date.soon({ days: 30 }).toISOString().split("T")[0],
  invoice_type_code: "380",
  invoice_kind: "B2B",
  document_currency_code: "NGN",
  accounting_supplier_party: {
    party_name: "Heirs Technologies",
    party_tax_scheme: { company_id: supplierTin },
    postal_address: {
      street_name: faker.location.streetAddress(),
      city_name: faker.location.city(),
      country: { identification_code: "NG" },
    },
  },
  accounting_customer_party: {
    party_name: faker.company.name(),
    party_tax_scheme: { company_id: buyerTin },
    postal_address: {
      street_name: faker.location.streetAddress(),
      city_name: faker.location.city(),
      country: { identification_code: "NG" },
    },
  },
  invoice_lines: [
    {
      id: "1",
      invoiced_quantity: faker.number.int({ min: 1, max: 5 }),
      line_extension_amount: amount,
      item: { description: faker.commerce.productName() },
      price: { price_amount: amount, base_quantity: 1, price_unit: "H87" },
    },
  ],
  tax_total: { tax_amount: vat },
  legal_monetary_total: {
    line_extension_amount: amount,
    tax_inclusive_amount: total,
    payable_amount: total,
  },
};

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
