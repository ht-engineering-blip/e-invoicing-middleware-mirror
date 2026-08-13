import { t } from "elysia";

export const PostalAddressSchema = t.Object(
  {
    street_name: t.Optional(
      t.String({
        description: "Street name of the address",
        examples: ["32, owonikoko street"],
      }),
    ),
    city_name: t.Optional(
      t.String({ description: "City name", examples: ["Gwarikpa"] }),
    ),
    postal_zone: t.Optional(
      t.String({ description: "Postal code/zone", examples: ["023401"] }),
    ),
    lga: t.Optional(
      t.String({
        description: "Local Government Area code (optional)",
        examples: ["NG-AB-ANO"],
      }),
    ),
    state: t.Optional(
      t.String({ description: "State code (optional)", examples: ["NG-AB"] }),
    ),
    country: t.Optional(
      t.String({
        description: "ISO country code (2 letters)",
        examples: ["NG"],
      }),
    ),
  },
  { description: "Postal address details" },
);

export const PartySchema = t.Object(
  {
    party_name: t.String({
      description: "Name of the party (supplier/customer)",
      examples: ["Heirs Technologies"],
    }),
    tin: t.String({
      description: "Taxpayer Identification Number (TIN)",
      examples: ["24058123-0001"],
    }),
    email: t.String({
      description: "Contact email",
      examples: ["business@email.com"],
    }),
    telephone: t.Optional(
      t.String({
        description: "Contact telephone (must start with +)",
        examples: ["+2348025409900"],
      }),
    ),
    business_description: t.Optional(
      t.String({ description: "Description of business activities" }),
    ),
    postal_address: t.Optional(PostalAddressSchema),
  },
  { description: "Party details" },
);

export const TaxCategorySchema = t.Object(
  {
    id: t.String({
      description: "Tax category ID (e.g., STANDARD_VAT, ZERO_VAT)",
      examples: ["STANDARD_VAT"],
    }),
    percent: t.Number({ description: "Tax rate percentage", examples: [7.5] }),
  },
  { description: "Tax category details" },
);

export const TaxSubtotalSchema = t.Object(
  {
    taxable_amount: t.Number({ description: "Taxable amount" }),
    tax_amount: t.Number({ description: "Tax amount calculated" }),
    tax_category: TaxCategorySchema,
  },
  { description: "Tax subtotal details" },
);

export const TaxTotalSchema = t.Object(
  {
    tax_amount: t.Number({ description: "Total tax amount" }),
    tax_subtotal: t.Array(TaxSubtotalSchema),
  },
  { description: "Tax total details" },
);

export const LegalMonetaryTotalSchema = t.Object(
  {
    line_extension_amount: t.Number({
      description: "Total line extension amount before tax and discount",
    }),
    tax_exclusive_amount: t.Number({ description: "Total taxable amount" }),
    tax_inclusive_amount: t.Number({
      description: "Total amount including tax",
    }),
    payable_amount: t.Number({ description: "Final payable amount" }),
  },
  { description: "Legal monetary total details" },
);

export const ItemSchema = t.Object(
  {
    name: t.String({ description: "Name of the item/service" }),
    description: t.String({ description: "Detailed description of the item" }),
    sellers_item_identification: t.Optional(
      t.String({ description: "Seller's internal item ID" }),
    ),
  },
  { description: "Item metadata" },
);

export const PriceSchema = t.Object(
  {
    price_amount: t.Number({ description: "Unit price of the item" }),
    base_quantity: t.Number({ description: "Base quantity for unit price" }),
    price_unit: t.String({
      description: "Unit of measure code",
      examples: ["XBG", "H87"],
    }),
  },
  { description: "Price details" },
);

export const InvoiceLineSchema = t.Object(
  {
    hsn_code: t.Optional(
      t.String({
        description: "WCO HS Code (for goods)",
        examples: ["1006.30"],
      }),
    ),
    isic_code: t.Optional(
      t.String({ description: "ISIC code (for services)", examples: ["0112"] }),
    ),
    product_category: t.Optional(
      t.String({ description: "Product category name" }),
    ),
    service_category: t.Optional(
      t.String({ description: "Service category name" }),
    ),
    discount_rate: t.Optional(
      t.Number({ description: "Discount percentage rate" }),
    ),
    discount_amount: t.Optional(t.Number({ description: "Discount amount" })),
    fee_rate: t.Optional(t.Number({ description: "Fee percentage rate" })),
    fee_amount: t.Optional(t.Number({ description: "Fee amount" })),
    invoiced_quantity: t.Number({ description: "Quantity invoiced" }),
    line_extension_amount: t.Number({ description: "Line net total amount" }),
    item: ItemSchema,
    price: PriceSchema,
  },
  { description: "Invoice line item details" },
);

export const DocumentReferenceSchema = t.Object({
  irn: t.String({ description: "Linked invoice IRN reference" }),
  issue_date: t.String({ description: "Issue date of the referenced invoice" }),
});

export const FIRSInvoicePayloadSchema = t.Object(
  {
    business_id: t.String({
      description: "Business UUID identifier",
      examples: ["8f8b8e88-6b83-4a34-934d-1a8684bb57f2"],
    }),
    irn: t.String({
      description: "Invoice Registration Number (IRN)",
      examples: ["INV1234-SERVICEID-20260805"],
    }),
    invoice_number: t.String({
      description: "Invoice reference number",
      examples: ["INV-1024"],
    }),
    issue_date: t.String({
      description: "Invoice issue date (YYYY-MM-DD)",
      examples: ["2026-08-05"],
    }),
    due_date: t.Optional(
      t.String({ description: "Invoice payment due date (YYYY-MM-DD)" }),
    ),
    issue_time: t.Optional(
      t.String({
        description: "Invoice issue time (HH:MM:SS)",
        examples: ["17:59:04"],
      }),
    ),
    invoice_type_code: t.String({
      description:
        "Invoice type code (e.g. 380 = Commercial, 381 = Credit note, 396 = Debit note)",
      examples: ["380"],
    }),
    invoice_kind: t.String({
      description: "Invoice kind (B2B, B2C, B2G)",
      examples: ["B2B"],
    }),
    payment_status: t.Optional(
      t.String({
        description: "Current payment status of the invoice",
        default: "PENDING",
        examples: ["PENDING"],
      }),
    ),
    note: t.Optional(t.String({ description: "Additional notes/comments" })),
    tax_point_date: t.Optional(t.String({ description: "Tax point date" })),
    document_currency_code: t.String({
      description: "Standard currency code for the invoice documents",
      default: "NGN",
      examples: ["NGN"],
    }),
    tax_currency_code: t.Optional(
      t.String({
        description: "Currency code for tax calculation",
        default: "NGN",
        examples: ["NGN"],
      }),
    ),
    accounting_cost: t.Optional(
      t.String({ description: "Accounting cost reference code" }),
    ),
    buyer_reference: t.Optional(
      t.String({ description: "Buyer specific reference key" }),
    ),
    order_reference: t.Optional(
      t.String({ description: "Sales order reference number" }),
    ),

    accounting_supplier_party: PartySchema,
    accounting_customer_party: PartySchema,

    invoice_line: t.Array(InvoiceLineSchema),
    tax_total: t.Array(TaxTotalSchema),
    legal_monetary_total: LegalMonetaryTotalSchema,

    billing_reference: t.Optional(t.Array(DocumentReferenceSchema)),
    dispatch_document_reference: t.Optional(DocumentReferenceSchema),
    receipt_document_reference: t.Optional(DocumentReferenceSchema),
    originator_document_reference: t.Optional(DocumentReferenceSchema),
    contract_document_reference: t.Optional(DocumentReferenceSchema),
    additional_document_reference: t.Optional(t.Array(DocumentReferenceSchema)),

    actual_delivery_date: t.Optional(t.String()),
    payment_means: t.Optional(
      t.Array(
        t.Object({
          payment_means_code: t.String(),
          payment_due_date: t.String(),
        }),
      ),
    ),
    payment_terms_note: t.Optional(t.String()),
    allowance_charge: t.Optional(
      t.Array(
        t.Object({
          charge_indicator: t.Boolean(),
          amount: t.Number(),
        }),
      ),
    ),
  },
  { description: "FIRS UBL Compliant Invoice Payload Schema" },
);

export const InboundInvoicePayloadSchema = t.Object(
  {
    irn: t.String({
      description:
        "The Invoice Registration Number (IRN) of the inbound invoice to retrieve and process",
      examples: ["INV1234-SERVICEID-20260805"],
    }),
  },
  { description: "Inbound Invoice Payload Schema" },
);
