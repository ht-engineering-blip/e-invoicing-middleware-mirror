import { z } from "zod";
import { sanitizeHsnCode, sanitizePriceUnit } from "./utils";

export const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Must be YYYY-MM-DD");

export const TimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}:\d{2}$/, "Invalid time format. Must be HH:MM:SS");

export const PhoneSchema = z.preprocess((val) => {
  if (!val || typeof val !== "string") return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("+")) return `+${trimmed}`;
  return trimmed;
}, z.string().regex(/^\+/, "Phone must start with + (country code)").optional());

export const AddressSchema = z.object({
  street_name: z.string().nullish(),
  city_name: z.string().nullish(),
  postal_zone: z.string().nullish(),
  country: z.string().nullish().default("NG"),
  lga: z.string().nullish(),
  state: z.string().nullish(),
});

export const PartySchema = z.object({
  party_name: z.string().nullish(),
  tin: z.string().nullish(),
  email: z.preprocess((val) => {
    if (typeof val === "string" && val.includes("@")) return val.trim();
    return undefined;
  }, z.string().email().optional().nullish()),
  telephone: PhoneSchema.nullish(),
  business_description: z.string().nullish(),
  postal_address: AddressSchema.nullish(),
});

const NumericSchema = z.preprocess((val) => {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[^0-9.-]+/g, "");
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}, z.number());

export const TaxSubtotalSchema = z.object({
  taxable_amount: NumericSchema,
  tax_amount: NumericSchema,
  tax_category: z.object({
    id: z.string(),
    percent: NumericSchema,
  }),
});

export const TaxTotalSchema = z.object({
  tax_amount: NumericSchema,
  tax_subtotal: z.array(TaxSubtotalSchema).min(1),
});

export const LegalMonetaryTotalSchema = z.object({
  line_extension_amount: NumericSchema,
  tax_exclusive_amount: NumericSchema,
  tax_inclusive_amount: NumericSchema,
  payable_amount: NumericSchema,
  prepaid_amount: NumericSchema.nullish(),
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
      .nullish(),
  ),
  isic_code: z.string().nullish(),
  product_category: z.string().nullish(),
  service_category: z.string().nullish(),
  invoiced_quantity: NumericSchema,
  line_extension_amount: NumericSchema,
  item: z.object({
    name: z
      .string()
      .transform((val) =>
        val && val.trim() !== "" ? val.trim() : "General Item",
      )
      .default("General Item"),
    description: z
      .string()
      .transform((val) =>
        val && val.trim() !== "" ? val.trim() : "General Item Description",
      )
      .default("General Item Description"),
    sellers_item_identification: z.string().nullish(),
  }),
  price: z.object({
    price_amount: NumericSchema,
    base_quantity: NumericSchema.default(1),
    price_unit: z
      .string()
      .transform((val) => sanitizePriceUnit(val))
      .default("H87"),
  }),
  discount_rate: NumericSchema.nullish(),
  discount_amount: NumericSchema.nullish(),
  fee_rate: NumericSchema.nullish(),
  fee_amount: NumericSchema.nullish(),
});

export const DocumentReferenceSchema = z.object({
  irn: z.string(),
  issue_date: z.string().nullish(),
});

export const FIRSInvoiceSchema = z.object({
  business_id: z.string().optional(),
  irn: z.string().optional(),
  issue_date: DateSchema,
  due_date: DateSchema.nullish(),
  issue_time: TimeSchema.nullish(),
  invoice_type_code: z.string().default("381"),
  invoice_kind: z.string().default("B2B"),
  payment_status: z.string().default("PENDING"),
  note: z.string().nullish(),
  tax_point_date: DateSchema.nullish(),
  document_currency_code: z.string().default("NGN"),
  tax_currency_code: z.string().default("NGN"),
  accounting_cost: z.string().nullish(),
  buyer_reference: z.string().nullish(),
  invoice_delivery_period: z
    .object({
      start_date: DateSchema.nullish(),
      end_date: DateSchema.nullish(),
    })
    .nullish(),
  order_reference: z.string().nullish(),
  billing_reference: z.array(DocumentReferenceSchema).nullish(),
  dispatch_document_reference: DocumentReferenceSchema.nullish(),
  receipt_document_reference: DocumentReferenceSchema.nullish(),
  originator_document_reference: DocumentReferenceSchema.nullish(),
  contract_document_reference: DocumentReferenceSchema.nullish(),
  additional_document_reference: z.array(DocumentReferenceSchema).nullish(),
  accounting_supplier_party: PartySchema,
  accounting_customer_party: PartySchema,
  payee_party: PartySchema.nullish(),
  bill_party: PartySchema.nullish(),
  ship_party: PartySchema.nullish(),
  tax_representative_party: PartySchema.nullish(),
  actual_delivery_date: DateSchema.nullish(),
  payment_means: z
    .array(
      z.object({
        payment_means_code: z.string(),
        payment_due_date: DateSchema.nullish(),
      }),
    )
    .nullish(),
  payment_terms_note: z.string().nullish(),
  allowance_charge: z
    .array(
      z.object({
        charge_indicator: z.boolean(),
        amount: NumericSchema,
      }),
    )
    .nullish(),
  tax_total: z.array(TaxTotalSchema).min(1),
  legal_monetary_total: LegalMonetaryTotalSchema,
  invoice_line: z.array(InvoiceLineSchema).min(1),
  invoice_reference: z.string().nullish(),
});

export type Address = z.infer<typeof AddressSchema>;
export type Party = z.infer<typeof PartySchema>;
export type TaxSubtotal = z.infer<typeof TaxSubtotalSchema>;
export type TaxTotal = z.infer<typeof TaxTotalSchema>;
export type LegalMonetaryTotal = z.infer<typeof LegalMonetaryTotalSchema>;
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;
export type DocumentReference = z.infer<typeof DocumentReferenceSchema>;
export type FIRSInvoice = z.infer<typeof FIRSInvoiceSchema>;
