import { z } from "zod";
import { sanitizeHsnCode, sanitizePriceUnit } from "./utils";

export const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Must be YYYY-MM-DD");

export const TimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}:\d{2}$/, "Invalid time format. Must be HH:MM:SS");

export const PhoneSchema = z
  .string()
  .regex(/^\+/, "Phone must start with + (country code)")
  .optional();

export const AddressSchema = z.object({
  street_name: z.string(),
  city_name: z.string(),
  postal_zone: z.string(),
  country: z.string(),
  lga: z.string().optional(),
  state: z.string().optional(),
});

export const PartySchema = z.object({
  party_name: z.string(),
  tin: z.string(),
  email: z.string().email(),
  telephone: PhoneSchema,
  business_description: z.string().optional(),
  postal_address: AddressSchema,
});

export const TaxSubtotalSchema = z.object({
  taxable_amount: z.number(),
  tax_amount: z.number(),
  tax_category: z.object({
    id: z.string(),
    percent: z.number(),
  }),
});

export const TaxTotalSchema = z.object({
  tax_amount: z.number(),
  tax_subtotal: z.array(TaxSubtotalSchema).min(1),
});

export const LegalMonetaryTotalSchema = z.object({
  line_extension_amount: z.number(),
  tax_exclusive_amount: z.number(),
  tax_inclusive_amount: z.number(),
  payable_amount: z.number(),
});

export const InvoiceLineSchema = z.object({
  hsn_code: z.preprocess(
    (val) => (val === undefined || val === null ? "" : String(val).trim()),
    z
      .string()
      .transform((val) => {
        if (!val) return "";
        const sanitized = sanitizeHsnCode(val);
        if (sanitized !== undefined) return sanitized;
        return val;
      })
      .optional(),
  ),
  isic_code: z.string().optional(),
  product_category: z.string().optional(),
  service_category: z.string().optional(),
  invoiced_quantity: z.number(),
  line_extension_amount: z.number(),
  item: z.object({
    name: z.string(),
    description: z.string(),
    sellers_item_identification: z.string().optional(),
  }),
  price: z.object({
    price_amount: z.number(),
    base_quantity: z.number(),
    price_unit: z
      .string()
      .transform((val) => sanitizePriceUnit(val))
      .default("H87"),
  }),
  discount_rate: z.number().optional(),
  discount_amount: z.number().optional(),
  fee_rate: z.number().optional(),
  fee_amount: z.number().optional(),
});

export const DocumentReferenceSchema = z.object({
  irn: z.string(),
  issue_date: z.string().optional(),
});

export const FIRSInvoiceSchema = z.object({
  business_id: z.string(),
  irn: z.string(),
  issue_date: DateSchema,
  due_date: DateSchema.optional(),
  issue_time: TimeSchema.optional(),
  invoice_type_code: z.string().default("396"),
  invoice_kind: z.string().default("B2B"),
  payment_status: z.string().default("PENDING"),
  note: z.string().optional(),
  tax_point_date: DateSchema.optional(),
  document_currency_code: z.string().default("NGN"),
  tax_currency_code: z.string().default("NGN"),
  accounting_cost: z.string().optional(),
  buyer_reference: z.string().optional(),
  invoice_delivery_period: z
    .object({
      start_date: DateSchema.optional(),
      end_date: DateSchema.optional(),
    })
    .optional(),
  order_reference: z.string().optional(),
  billing_reference: z.array(DocumentReferenceSchema).optional(),
  dispatch_document_reference: DocumentReferenceSchema.optional(),
  receipt_document_reference: DocumentReferenceSchema.optional(),
  originator_document_reference: DocumentReferenceSchema.optional(),
  contract_document_reference: DocumentReferenceSchema.optional(),
  additional_document_reference: z.array(DocumentReferenceSchema).optional(),
  accounting_supplier_party: PartySchema,
  accounting_customer_party: PartySchema,
  payee_party: PartySchema.optional(),
  bill_party: PartySchema.optional(),
  ship_party: PartySchema.optional(),
  tax_representative_party: PartySchema.optional(),
  actual_delivery_date: DateSchema.optional(),
  payment_means: z
    .array(
      z.object({
        payment_means_code: z.string(),
        payment_due_date: DateSchema.optional(),
      }),
    )
    .optional(),
  payment_terms_note: z.string().optional(),
  allowance_charge: z
    .array(
      z.object({
        charge_indicator: z.boolean(),
        amount: z.number(),
      }),
    )
    .optional(),
  tax_total: z.array(TaxTotalSchema).min(1),
  legal_monetary_total: LegalMonetaryTotalSchema,
  invoice_line: z.array(InvoiceLineSchema).min(1),
  invoice_reference: z.string().optional(),
});

export type FIRSInvoice = z.infer<typeof FIRSInvoiceSchema>;
