import { firsConfig } from "../../../@config";

export const FIRS_INVOICE_METADATA = {
  field_metadata: {
    due_date: {
      required: false,
      description: "optional",
      category: "invoice_dates",
    },
    issue_time: {
      required: false,
      description: "optional",
      category: "invoice_dates",
    },
    invoice_type_code: {
      required: true,
      description: "invoice type code",
      category: "invoice_identification",
    },
    payment_status: {
      required: false,
      description: "optional, defaults to pending",
      default_value: "PENDING",
      category: "payment",
    },
    note: {
      required: false,
      description: "optional, will be encrypted in storage",
      encryption: true,
      category: "miscellaneous",
    },
    tax_point_date: {
      required: false,
      description: "optional",
      category: "tax",
    },
    tax_currency_code: {
      required: false,
      description: "optional",
      category: "currency",
    },
    accounting_cost: {
      required: false,
      description: "optional",
      category: "accounting",
    },
    buyer_reference: {
      required: false,
      description: "optional",
      category: "references",
    },
    invoice_kind: {
      required: true,
      description: "invoice kind (e.g. B2B, B2C)",
      category: "invoice_type",
    },
    invoice_delivery_period: {
      required: false,
      description: "optional",
      category: "delivery",
    },
    order_reference: {
      required: false,
      description: "optional",
      category: "references",
    },
    billing_reference: {
      required: false,
      description: "optional array, second element optional",
      array_rules: {
        min_items: 0,
        max_items: null,
        optional_elements: "second and beyond",
      },
      category: "references",
    },
    dispatch_document_reference: {
      required: false,
      description: "optional",
      category: "references",
    },
    receipt_document_reference: {
      required: false,
      description: "optional",
      category: "references",
    },
    originator_document_reference: {
      required: false,
      description: "optional",
      category: "references",
    },
    contract_document_reference: {
      required: false,
      description: "optional",
      category: "references",
    },
    additional_document_reference: {
      required: false,
      description: "optional",
      category: "references",
    },
    "accounting_supplier_party.tin": {
      required: true,
      description: "now mandatory",
      category: "party_identification",
    },
    "accounting_supplier_party.email": {
      required: true,
      description: "now mandatory",
      category: "party_contact",
    },
    "accounting_supplier_party.telephone": {
      required: false,
      description: "optional, must start with + (meaning country code)",
      validation: "must start with +",
      category: "party_contact",
    },
    "accounting_supplier_party.business_description": {
      required: false,
      description: "optional",
      category: "party_info",
    },
    "accounting_customer_party.tin": {
      required: true,
      description: "now mandatory",
      category: "party_identification",
    },
    "accounting_customer_party.email": {
      required: true,
      description: "now mandatory",
      category: "party_contact",
    },
    "accounting_customer_party.telephone": {
      required: false,
      description: "optional, must start with + (meaning country code)",
      validation: "must start with +",
      category: "party_contact",
    },
    "accounting_customer_party.business_description": {
      required: false,
      description: "optional",
      category: "party_info",
    },
    bill_party: {
      required: false,
      description:
        "optional (party object, just like accounting_customer_party)",
      category: "additional_parties",
    },
    ship_party: {
      required: false,
      description:
        "optional (party object, just like accounting_customer_party)",
      category: "additional_parties",
    },
    payee_party: {
      required: false,
      description:
        "optional (party object, just like accounting_customer_party)",
      category: "additional_parties",
    },
    tax_representative_party: {
      required: false,
      description:
        "optional (party object, just like accounting_customer_party)",
      category: "additional_parties",
    },
    actual_delivery_date: {
      required: false,
      description: "optional",
      category: "delivery",
    },
    payment_means: {
      required: false,
      description: "optional array, second element optional",
      array_rules: {
        min_items: 0,
        max_items: null,
        optional_elements: "second and beyond",
      },
      category: "payment",
    },
    payment_terms_note: {
      required: false,
      description: "optional, will be encrypted in storage",
      encryption: true,
      category: "payment",
    },
    allowance_charge: {
      required: false,
      description: "optional array, second element optional",
      array_rules: {
        min_items: 0,
        max_items: null,
        optional_elements: "second and beyond",
      },
      charge_indicator_description:
        "indicates whether the amount is a charge (true) or an allowance (false)",
      category: "financial",
    },
    tax_total: {
      required: true,
      description: "mandatory array, additional elements optional",
      array_rules: {
        min_items: 1,
        max_items: null,
        optional_elements: "second and beyond",
      },
      category: "tax",
    },
    invoice_line: {
      required: true,
      description: "required array, second line item optional",
      array_rules: {
        min_items: 1,
        max_items: null,
        optional_elements: "second and beyond",
      },
      category: "line_items",
    },
    "invoice_line[].sellers_item_identification": {
      required: false,
      description: "optional",
      category: "line_items",
    },
  },
  document_metadata: {
    version: "1.0",
    schema: "FIRS_MBS_Invoice",
    country: "Nigeria",
    currency_default: "NGN",
    date_format: "YYYY-MM-DD",
    time_format: "HH:MM:SS",
    encrypted_fields: ["note", "payment_terms_note"],
    generated_at: "2024-01-26T00:00:00Z",
  },
  category_summary: {
    required_fields: [
      "business_id",
      "irn",
      "issue_date",
      "invoice_type_code",
      "document_currency_code",
      "invoice_kind",
      "accounting_supplier_party.tin",
      "accounting_supplier_party.email",
      "accounting_customer_party.tin",
      "accounting_customer_party.email",
      "legal_monetary_total",
      "tax_total",
      "invoice_line",
    ],
    optional_fields: [
      "due_date",
      "issue_time",
      "payment_status",
      "note",
      "tax_point_date",
      "tax_currency_code",
      "accounting_cost",
      "buyer_reference",
      "invoice_type",
      "invoice_delivery_period",
      "order_reference",
      "billing_reference",
      "dispatch_document_reference",
      "receipt_document_reference",
      "originator_document_reference",
      "contract_document_reference",
      "additional_document_reference",
      "accounting_supplier_party.telephone",
      "accounting_supplier_party.business_description",
      "accounting_customer_party.telephone",
      "accounting_customer_party.business_description",
      "actual_delivery_date",
      "payment_means",
      "payment_terms_note",
      "allowance_charge",
      "tax_total",
    ],
  },
};

export const FIRS_INVOICE_SCHEMA = {
  business_id: "{{BUSINESS_ID}}",
  irn: "IRN",
  issue_date: "2024-05-14",
  due_date: "2024-06-14",
  issue_time: "17:59:04",
  invoice_type_code: "396",
  invoice_kind: "B2B",
  payment_status: "PENDING",
  note: "dummy_note (will be encryted in storage)",
  tax_point_date: "2024-05-14",
  document_currency_code: "NGN",
  tax_currency_code: "NGN",
  accounting_cost: "2000 NGN",
  buyer_reference: "buyer REF IRN?",
  invoice_delivery_period: {
    start_date: "2024-06-14",
    end_date: "2024-06-16",
  },
  order_reference: "order REF IRN?",
  billing_reference: [
    {
      irn: "ITW001-E9E0C0D3-20240619",
      issue_date: "2024-05-14",
    },
    {
      irn: "ITW001-E9E0C0D3-20240619",
      issue_date: "2024-05-14",
    },
  ],
  dispatch_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: "2024-05-14",
  },
  receipt_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: "2024-05-14",
  },
  originator_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: "2024-05-14",
  },
  contract_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: "2024-05-14",
  },
  additional_document_reference: [
    {
      irn: "ITW001-E9E0C0D3-20240619",
      issue_date: "2024-05-14",
    },
  ],
  accounting_supplier_party: {
    party_name: "Heirs Technologies",
    tin: "TIN-0099990001",
    email: "supplier_business@email.com",
    telephone: "+23480254099000",
    business_description:
      "this entity is into sales of Cement and building materials",
    postal_address: {
      street_name: "32, owonikoko street",
      city_name: "Gwarikpa",
      postal_zone: "023401",
      country: "NG",
    },
  },
  accounting_customer_party: {
    party_name: "Dangote Group",
    tin: "TIN-000001",
    email: "business@email.com",
    telephone: "+23480254000000",
    business_description:
      "this entity is into sales of Cement and building materials",
    postal_address: {
      street_name: "32, owonikoko street",
      city_name: "Gwarikpa",
      postal_zone: "023401",
      country: "NG",
    },
  },
  actual_delivery_date: "2024-05-14",
  payment_means: [
    {
      payment_means_code: "10",
      payment_due_date: "2024-05-14",
    },
    {
      payment_means_code: "43",
      payment_due_date: "2024-05-14",
    },
  ],
  payment_terms_note: "dummy payment terms note (will be encryted in storage)",
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
          tax_amount: 8,
          tax_category: {
            id: "LOCAL_SALES_TAX",
            percent: 2.3,
          },
        },
      ],
    },
  ],
  legal_monetary_total: {
    line_extension_amount: 340.5,
    tax_exclusive_amount: 400,
    tax_inclusive_amount: 430,
    payable_amount: 30,
  },
  invoice_line: [
    {
      hsn_code: "90983.00",
      product_category: "Food and Beverages",
      discount_rate: 2.01,
      discount_amount: 0.603,
      fee_rate: 1.01,
      fee_amount: 50,
      invoiced_quantity: 15,
      line_extension_amount: 30,
      item: {
        name: "item name",
        description: "item description",
        sellers_item_identification: "identified as spoon by the seller",
      },
      price: {
        price_amount: 10,
        base_quantity: 3,
        price_unit: "H87",
      },
    },
    {
      hsn_code: "90983.00",
      product_category: "Food and Beverages",
      discount_rate: 2.01,
      discount_amount: 0.603,
      fee_rate: 1.01,
      fee_amount: 50,
      invoiced_quantity: 15,
      line_extension_amount: 30,
      item: {
        name: "item nam 2",
        description: "item description 2",
        sellers_item_identification: "identified as shovel by the seller",
      },
      price: {
        price_amount: 20,
        base_quantity: 5,
        price_unit: "H87",
      },
    },
  ],
};
export const FIRS_INVOICE_SCHEMA_V2 = {
  business_id: "{{BUSINESS_ID}}",
  irn: "IRN",
  issue_date: "2024-05-14",
  due_date: "2024-06-14",
  issue_time: "17:59:04",
  invoice_type_code: "396",
  invoice_kind: "B2B",
  payment_status: "PENDING",
  note: "dummy_note (will be encryted in storage)",
  tax_point_date: "2024-05-14",
  document_currency_code: "NGN",
  tax_currency_code: "NGN",
  accounting_cost: "2000 NGN",
  buyer_reference: "buyer REF IRN?",
  invoice_delivery_period: {
    start_date: "2024-06-14",
    end_date: "2024-06-16",
  },
  order_reference: "order REF IRN?",
  billing_reference: [
    {
      irn: "ITW001-E9E0C0D3-20240619",
      issue_date: "2024-05-14",
    },
    {
      irn: "ITW001-E9E0C0D3-20240619",
      issue_date: "2024-05-14",
    },
  ],
  dispatch_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: "2024-05-14",
  },
  receipt_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: "2024-05-14",
  },
  originator_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: "2024-05-14",
  },
  contract_document_reference: {
    irn: "ITW001-E9E0C0D3-20240619",
    issue_date: "2024-05-14",
  },
  additional_document_reference: [
    {
      irn: "ITW001-E9E0C0D3-20240619",
      issue_date: "2024-05-14",
    },
  ],
  accounting_supplier_party: {
    party_name: "Heirs Technologies",
    tin: "TIN-0099990001",
    email: "supplier_business@email.com",
    telephone: "+23480254099000",
    business_description:
      "this entity is into sales of Cement and building materials",
    postal_address: {
      street_name: "32, owonikoko street",
      city_name: "Gwarikpa",
      postal_zone: "023401",
      country: "NG",
    },
  },
  accounting_customer_party: {
    party_name: "Dangote Group",
    tin: "TIN-000001",
    email: "business@email.com",
    telephone: "+23480254000000",
    business_description:
      "this entity is into sales of Cement and building materials",
    postal_address: {
      street_name: "32, owonikoko street",
      city_name: "Gwarikpa",
      postal_zone: "023401",
      country: "NG",
    },
  },
  actual_delivery_date: "2024-05-14",
  payment_means: [
    {
      payment_means_code: "10",
      payment_due_date: "2024-05-14",
    },
    {
      payment_means_code: "43",
      payment_due_date: "2024-05-14",
    },
  ],
  payment_terms_note: "dummy payment terms note (will be encryted in storage)",
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
          tax_amount: 8,
          tax_category: {
            id: "LOCAL_SALES_TAX",
            percent: 2.3,
          },
        },
      ],
    },
  ],
  legal_monetary_total: {
    line_extension_amount: 340.5,
    tax_exclusive_amount: 400,
    tax_inclusive_amount: 430,
    payable_amount: 30,
  },
  invoice_line: [
    {
      hsn_code: "90983.00",
      product_category: "Food and Beverages",
      discount_rate: 2.01,
      discount_amount: 0.603,
      fee_rate: 1.01,
      fee_amount: 50,
      invoiced_quantity: 15,
      line_extension_amount: 30,
      item: {
        name: "item name",
        description: "item description",
        sellers_item_identification: "identified as spoon by the seller",
      },
      price: {
        price_amount: 10,
        base_quantity: 3,
        price_unit: "H87",
      },
    },
    {
      hsn_code: "90983.00",
      product_category: "Food and Beverages",
      discount_rate: 2.01,
      discount_amount: 0.603,
      fee_rate: 1.01,
      fee_amount: 50,
      invoiced_quantity: 15,
      line_extension_amount: 30,
      item: {
        name: "item nam 2",
        description: "item description 2",
        sellers_item_identification: "identified as shovel by the seller",
      },
      price: {
        price_amount: 20,
        base_quantity: 5,
        price_unit: "H87",
      },
    },
  ],
};
