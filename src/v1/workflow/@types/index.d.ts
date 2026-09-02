interface OkayResponse {
  code: number;
  message?: string;
  errors?: string[] | string;
  data: { ok: boolean; message?: string; errors?: string[] };
}

interface ConfirmResponse {
  code: number;
  data: {
    issue_date: string;
    due_date: string;
    sync_date: string;
    payment_status: string;
    transmitted: boolean;
    delivered: boolean;
  };
}

interface SearchResponse {
  code: number;
  data: {
    items: Array<{
      irn: string;
      payment_status: string;
      entry_status: string;
      invoice_type_code: string;
      issue_date: Date;
      due_date: Date;
      sync_date: Date;
      document_currency_code: string;
      tax_currency_code: string;
    }>;
    page: {
      page: number;
      size: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      totalCount: number;
    };
  };
  attributes: any;
}

interface SecureInvoice {
  tenant_id: string;
  tenantId?: string;
  business_id: string;
  irn: string;
  invoice_line?: InvoiceLineInput[];
  data?: Record<string, any>;
  [key: string]: unknown;
}

interface PostalAddressInput {
  street_name?: string;
  city_name?: string;
  postal_zone?: string;
  country?: string;
  [key: string]: unknown;
}

interface PartyInput {
  party_name: string;
  tin: string;
  email: string;
  telephone?: string;
  business_description?: string;
  postal_address?: PostalAddressInput;
  [key: string]: unknown;
}

interface TaxCategoryInput {
  id: string;
  percent: number;
  [key: string]: unknown;
}

interface TaxSubtotalInput {
  taxable_amount: number;
  tax_amount: number;
  tax_category: TaxCategoryInput;
  [key: string]: unknown;
}

interface TaxTotalInput {
  tax_amount: number;
  tax_subtotal: TaxSubtotalInput[];
  [key: string]: unknown;
}

interface ItemInput {
  name: string;
  description: string;
  [key: string]: unknown;
}

interface PriceInput {
  price_amount: number;
  base_quantity: number;
  price_unit: string;
  [key: string]: unknown;
}

interface InvoiceLineInput {
  hsn_code?: string;
  product_category?: string;
  service_category?: string;
  discount_rate?: number;
  discount_amount?: number;
  fee_rate?: number;
  fee_amount?: number;
  invoiced_quantity: number;
  line_extension_amount: number;
  item: ItemInput;
  price: PriceInput;
  [key: string]: unknown;
}

interface LegalMonetaryTotal {
  line_extension_amount: number;
  tax_exclusive_amount: number;
  tax_inclusive_amount: number;
  payable_amount: number;
  [key: string]: unknown;
}

interface BillingReferenceInput {
  irn: string;
  issue_date?: string;
  [key: string]: unknown;
}

interface DocumentReferenceInput {
  irn: string;
  issue_date?: string;
  [key: string]: unknown;
}

interface StandardInvoicePayload {
  business_id?: string;
  irn?: string;
  accounting_supplier_party?: PartyInput;
  accounting_customer_party?: PartyInput;
  issue_date?: string;
  due_date?: string;
  invoice_type_code?: string;
  invoice_kind?: string;
  payment_status?: string;
  document_currency_code?: string;
  tax_currency_code?: string;
  legal_monetary_total?: LegalMonetaryTotal;
  tax_total?: TaxTotalInput[];
  invoice_line?: InvoiceLineInput[];
  invoice_reference?: string;
  sourceType?: string;
  tenant_id?: string;
  note?: string;
  [key: string]: unknown;
}

interface CreditNotePayload {
  business_id?: string;
  irn?: string;
  accounting_supplier_party?: PartyInput;
  accounting_customer_party?: PartyInput;
  issue_date?: string;
  due_date?: string;
  invoice_type_code?: "380" | "393" | "395" | string;
  invoice_kind?: string;
  payment_status?: string;
  document_currency_code?: string;
  tax_currency_code?: string;
  billing_reference?: BillingReferenceInput[];
  legal_monetary_total?: LegalMonetaryTotal;
  tax_total?: TaxTotalInput[];
  invoice_line?: InvoiceLineInput[];
  invoice_reference?: string;
  sourceType?: string;
  tenant_id?: string;
  note?: string;
  [key: string]: unknown;
}

interface DebitNotePayload {
  business_id?: string;
  irn?: string;
  accounting_supplier_party?: PartyInput;
  accounting_customer_party?: PartyInput;
  issue_date?: string;
  due_date?: string;
  invoice_type_code?: "383" | "384" | string;
  invoice_kind?: string;
  payment_status?: string;
  document_currency_code?: string;
  tax_currency_code?: string;
  billing_reference?: BillingReferenceInput[];
  legal_monetary_total?: LegalMonetaryTotal;
  tax_total?: TaxTotalInput[];
  invoice_line?: InvoiceLineInput[];
  invoice_reference?: string;
  sourceType?: string;
  tenant_id?: string;
  note?: string;
  [key: string]: unknown;
}

interface InvoicePayload {
  business_id?: string;
  irn?: string;
  accounting_supplier_party?: PartyInput;
  accounting_customer_party?: PartyInput;
  issue_date?: string;
  due_date?: string;
  invoice_type_code?: string;
  invoice_kind?: string;
  payment_status?: string;
  document_currency_code?: string;
  tax_currency_code?: string;
  billing_reference?: BillingReferenceInput[];
  dispatch_document_reference?: DocumentReferenceInput;
  receipt_document_reference?: DocumentReferenceInput;
  originator_document_reference?: DocumentReferenceInput;
  contract_document_reference?: DocumentReferenceInput;
  legal_monetary_total?: LegalMonetaryTotal;
  tax_total?: TaxTotalInput[];
  invoice_line?: InvoiceLineInput[];
  invoice_reference?: string;
  sourceType?: string;
  tenant_id?: string;
  note?: string;
  [key: string]: unknown;
}

type TransformInvoiceInput =
  | InvoicePayload
  | StandardInvoicePayload
  | CreditNotePayload
  | DebitNotePayload
  | NRSVerifiedInvoicePayload;

interface NRSPostalAddress {
  state?: string;
  country: string;
  city_name: string;
  postal_zone: string;
  street_name: string;
  [key: string]: unknown;
}

interface NRSParty {
  tin: string;
  email: string;
  telephone: string;
  party_name: string;
  postal_address: NRSPostalAddress;
  business_description: string;
  [key: string]: unknown;
}

interface NRSPrice {
  price_unit: string;
  price_amount: number;
  base_quantity: number;
  currency_code: string | null;
  original_price_amount: number | null;
  [key: string]: unknown;
}

interface NRSInvoiceLine {
  item_id: string;
  item: {
    name: string;
    description: string;
    sellers_item_identification: string;
  };
  price: NRSPrice;
  fee_rate: number;
  hsn_code: string;
  tax_rate: number;
  is_credit: boolean;
  isic_code: string;
  fee_amount: number;
  tax_amount: number;
  tax_category: string;
  currency_code: string;
  discount_rate: number;
  exchange_rate: string;
  discount_amount: number;
  tax_category_id: string;
  product_category: string;
  service_category: string;
  invoiced_quantity: number;
  exchange_rate_date: string;
  original_line_amount: number;
  line_extension_amount: number;
  exchange_rate_requested_date: string;
  [key: string]: unknown;
}

interface BankAccountDetails {
  id: string;
  label: string;
  branch: string;
  bank_name: string;
  account_name: string;
  extra_fields: any[];
  account_number: string;
  account_country: string;
  [key: string]: unknown;
}

interface SignatoryDetails {
  id: string;
  name: string;
  title: string;
  is_primary: boolean;
  signature_url: string;
  [key: string]: unknown;
}

interface NRSTaxCategory {
  id: string;
  percent: number;
  tax_category_id: string;
  [key: string]: unknown;
}

interface NRSTaxSubtotal {
  tax_amount: number;
  tax_category: NRSTaxCategory;
  taxable_amount: number;
  [key: string]: unknown;
}

interface NRSTaxTotal {
  tax_amount: number;
  tax_subtotal: NRSTaxSubtotal[];
  [key: string]: unknown;
}

interface NRSVerifiedInvoicePayload {
  business_id: string;
  irn: string;
  issue_date: string;
  invoice_type_code: string;
  invoice_kind: string;
  payment_status: string;
  document_currency_code: string;
  accounting_supplier_party: NRSParty;
  accounting_customer_party: NRSParty;
  legal_monetary_total: LegalMonetaryTotal;
  invoice_line: NRSInvoiceLine[];
  due_date: string;
  tax_currency_code: string;
  bank_accounts: BankAccountDetails[];
  signatories: SignatoryDetails[];
  tax_total: NRSTaxTotal[];
  event: string;
  eventType: string;
  timestamp: string;
  webhook_id: string;
  tenant_id: string;
  invoice_id: string;
  invoice_number: string;
  status: string;
  nrs_validated: boolean;
  [key: string]: unknown;
}

interface MappingRuleItem {
  source: string;
  target: string;
  transform?: string;
  [key: string]: unknown;
}
