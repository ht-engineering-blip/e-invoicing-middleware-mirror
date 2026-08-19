/**
 * Shared data envelope passed between every job in the chain.
 * `context` grows as each step appends its output.
 */
interface JobChainData {
  // ── Identity ──────────────────────────────────────────────────────────────
  jobChainId: string;       // unique ID for the entire chain run (tracing)
  webhookEventId: string;   // linked WebhookEventDocument.eventId
  tenantId: string;
  eventType: string;

  // ── Chain state ───────────────────────────────────────────────────────────
  actions: string[];        // full ordered action list e.g. ['transform','validate','sign']
  stepIndex: number;        // 0-based index of the CURRENT step

  // ── Auth (built once from tenant, reused across all steps) ────────────────
  authContext: {
    tenantId: string;
    businessId?: string;
    businessTIN?: string;
    serviceId?: string;
    tenantERP?: string;
    referenceIdKeyMap?: Record<string, string>;
    idKeyMap?: Record<string, string>;
    isAdmin: false;
  };

  // ── Pipeline context — grows as each step appends its output ──────────────
  context: {
    originalPayload: any;
    sourceType?: string;
    source?: string;               // OutboundInvoiceSource ('webhook' | 'api')
    irn?: string;
    erpInvoiceId?: string;
    transformedInvoice?: any;      // FIRS-formatted invoice (output of transform)
    validationResult?: any;        // output of validate
    signedInvoice?: any;           // output of sign
    transmissionResult?: any;      // output of transmit
    statusCheckResult?: any;       // output of confirm_invoice_status
    qrCode?: string;               // output of complete_outbound / generateQRCode
    firsSignedData?: any;          // encrypted signed payload returned by FIRS
    inboundResult?: any;           // output of complete_inbound
    vatReportData?: any;           // payment details for VAT/payment reporting
    vatReportResult?: any;         // output of report_vat / update_payment_status
    erpSyncResult?: any;           // output of sync_erp
    metadata?: Record<string, any>;
    [key: string]: any;
  };

  // ── Metadata ──────────────────────────────────────────────────────────────
  priority: number;         // higher = processed first
  routeId?: string;
}




interface ScheduleChainInput {
  webhookEventId: string;
  tenantId: string;
  eventType: string;
  payload: any;
  actions: string[];
  routeId?: string;
  priority?: number;
  /** ERP invoice identifier extracted from the webhook payload */
  erpInvoiceId?: string;
  /** Pre-generated IRN from the webhook handler (avoids duplicate generation) */
  irn?: string;
  /** Optional initial context values to preload (useful when retrying mid-chain) */
  initialContext?: Partial<JobChainData["context"]>;
}