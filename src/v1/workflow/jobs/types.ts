export enum WorkflowAction {
  TRANSFORM = "transform",
  VALIDATE = "validate",
  SIGN = "sign",
  GENERATE_IRN = "generate_irn",
  TRANSMIT = "transmit",
  CONFIRM_INVOICE_STATUS = "confirm_invoice_status",
  COMPLETE_OUTBOUND = "complete_outbound",
  COMPLETE_INBOUND = "complete_inbound",
  REPORT_VAT = "report_vat",
  UPDATE_PAYMENT_STATUS = "update_payment_status",
  SYNC_ERP = "sync_erp",
  PROCESS_CREDIT_NOTE = "process_credit_note",
  COMPLETE_CREDIT_NOTE = "complete_credit_note",
}

/** Default outbound processing chain */
export const DEFAULT_OUTBOUND_CHAIN: WorkflowAction[] = [
  WorkflowAction.TRANSFORM,
  WorkflowAction.VALIDATE,
  WorkflowAction.SIGN,
  WorkflowAction.GENERATE_IRN,
  WorkflowAction.TRANSMIT,
  WorkflowAction.CONFIRM_INVOICE_STATUS,
  WorkflowAction.COMPLETE_OUTBOUND,
];

/** Maps workflow action IDs → Agenda job names */
export const ACTION_TO_JOB: Record<string, string> = {
  [WorkflowAction.GENERATE_IRN]: "workflow:generate-irn",
  [WorkflowAction.TRANSFORM]: "workflow:transform",
  [WorkflowAction.VALIDATE]: "workflow:validate",
  [WorkflowAction.SIGN]: "workflow:sign",
  [WorkflowAction.TRANSMIT]: "workflow:transmit",
  [WorkflowAction.COMPLETE_OUTBOUND]: "workflow:complete-outbound",
  [WorkflowAction.COMPLETE_INBOUND]: "workflow:complete-inbound",
  [WorkflowAction.REPORT_VAT]: "workflow:report-vat",
  [WorkflowAction.CONFIRM_INVOICE_STATUS]: "workflow:confirm-status",
  [WorkflowAction.UPDATE_PAYMENT_STATUS]: "workflow:update-payment-status",
  [WorkflowAction.SYNC_ERP]: "workflow:sync-erp",
  [WorkflowAction.PROCESS_CREDIT_NOTE]: "workflow:process-credit-note",
  [WorkflowAction.COMPLETE_CREDIT_NOTE]: "workflow:complete-credit-note",
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
