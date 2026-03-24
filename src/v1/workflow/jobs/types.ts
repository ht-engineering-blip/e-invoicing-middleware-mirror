/**
 * Shared data envelope passed between every job in the chain.
 * `context` grows as each step appends its output.
 */
export interface JobChainData {
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
    isAdmin: false;
  };

  // ── Pipeline context — grows as each step appends its output ──────────────
  context: {
    originalPayload: any;
    sourceType?: string;
    irn?: string;
    erpInvoiceId?: string;
    transformedInvoice?: any;
    validationResult?: any;
    signedInvoice?: any;
    qrCode?: string;
    transmissionResult?: any;
    vatReportResult?: any;
    statusCheckResult?: any;
    inboundResult?: any;
    [key: string]: any;
  };

  // ── Metadata ──────────────────────────────────────────────────────────────
  priority: number;         // higher = processed first
  routeId?: string;
}

/** Maps workflow action IDs → Agenda job names */
export const ACTION_TO_JOB: Record<string, string> = {
  generate_irn:             'workflow:generate-irn',
  transform:                'workflow:transform',
  validate:                 'workflow:validate',
  sign:                     'workflow:sign',
  transmit:                 'workflow:transmit',
  complete_outbound:        'workflow:complete-outbound',
  complete_inbound:         'workflow:complete-inbound',
  report_vat:               'workflow:report-vat',
  confirm_invoice_status:   'workflow:confirm-status',
  update_payment_status:    'workflow:update-payment-status',
};

/** Default priority per event type */
export const EVENT_PRIORITY: Record<string, number> = {
  'invoice.failed':          10,
  'invoice.received':         5,
  'invoice.created':          5,
  'erp.invoice.submitted':    5,
};

export function getPriority(eventType: string): number {
  return EVENT_PRIORITY[eventType] ?? 0;
}
