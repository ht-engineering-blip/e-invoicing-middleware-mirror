/** Maps workflow action IDs → Agenda job names */
export const ACTION_TO_JOB: Record<string, string> = {
  generate_irn: "workflow:generate-irn",
  transform: "workflow:transform",
  validate: "workflow:validate",
  sign: "workflow:sign",
  transmit: "workflow:transmit",
  complete_outbound: "workflow:complete-outbound",
  complete_inbound: "workflow:complete-inbound",
  report_vat: "workflow:report-vat",
  confirm_invoice_status: "workflow:confirm-status",
  update_payment_status: "workflow:update-payment-status",
  sync_erp: "workflow:sync-erp",
  process_credit_note: "workflow:process-credit-note",
  complete_credit_note: "workflow:complete-credit-note",
};

/** Default priority per event type */
export const EVENT_PRIORITY: Record<string, number> = {
  "invoice.failed": 10,
  "invoice.received": 5,
  "invoice.created": 5,
  "erp.invoice.submitted": 5,
  "erp.creditnote.issued": 5,
};

export function getPriority(eventType: string): number {
  return EVENT_PRIORITY[eventType] ?? 0;
}
