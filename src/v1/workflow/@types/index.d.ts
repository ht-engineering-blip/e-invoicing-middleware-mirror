interface OkayResponse {
  code: number;
  data: { ok: boolean };
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
  business_id: string;
  irn: string;
  [key: string]: unknown;
}
