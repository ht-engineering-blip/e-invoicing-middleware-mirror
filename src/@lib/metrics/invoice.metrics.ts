import { client, metricsRegistry } from './registry';

/** Actions that count as invoice processing (not payment/VAT side-jobs). */
export const INVOICE_PIPELINE_ACTIONS = new Set([
  'generate_irn',
  'transform',
  'validate',
  'sign',
  'transmit',
  'complete_outbound',
  'complete_inbound',
  'confirm_invoice_status',
  'process_credit_note',
  'complete_credit_note',
]);

export function isInvoicePipeline(actions: string[] | undefined): boolean {
  if (!actions?.length) return false;
  return actions.some((a) => INVOICE_PIPELINE_ACTIONS.has(a));
}

function normalizeErp(erp?: string): string {
  const value = (erp || 'unknown').trim();
  return value.length ? value : 'unknown';
}

export const invoicesSubmittedTotal = new client.Counter({
  name: 'einvoice_invoices_submitted_total',
  help: 'Total invoices submitted for processing (recorded on worker when chain starts)',
  labelNames: ['tenant_id', 'source', 'event_type', 'erp_system'] as const,
  registers: [metricsRegistry],
});

export const invoicesAcceptedTotal = new client.Counter({
  name: 'einvoice_invoices_accepted_total',
  help: 'Total invoices accepted for processing (recorded on worker when chain starts)',
  labelNames: ['tenant_id', 'event_type', 'erp_system'] as const,
  registers: [metricsRegistry],
});

export const invoicesProcessedTotal = new client.Counter({
  name: 'einvoice_invoices_processed_total',
  help: 'Total invoices that reached a terminal processing outcome',
  labelNames: ['tenant_id', 'result', 'erp_system'] as const,
  registers: [metricsRegistry],
});

export const invoiceProcessingDurationSeconds = new client.Histogram({
  name: 'einvoice_invoice_processing_duration_seconds',
  help: 'End-to-end invoice processing duration from accept to terminal state',
  labelNames: ['tenant_id', 'result', 'erp_system'] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800],
  registers: [metricsRegistry],
});

function safeInc(fn: () => void): void {
  try {
    fn();
  } catch {
    // Never break invoice processing because of metrics
  }
}

export function recordInvoiceSubmitted(labels: {
  tenantId: string;
  source: string;
  eventType: string;
  erpSystem?: string;
}): void {
  safeInc(() =>
    invoicesSubmittedTotal.inc({
      tenant_id: labels.tenantId || 'unknown',
      source: labels.source || 'unknown',
      event_type: labels.eventType || 'unknown',
      erp_system: normalizeErp(labels.erpSystem),
    })
  );
}

export function recordInvoiceAccepted(labels: {
  tenantId: string;
  eventType: string;
  erpSystem?: string;
}): void {
  safeInc(() =>
    invoicesAcceptedTotal.inc({
      tenant_id: labels.tenantId || 'unknown',
      event_type: labels.eventType || 'unknown',
      erp_system: normalizeErp(labels.erpSystem),
    })
  );
}

export function recordInvoiceProcessed(labels: {
  tenantId: string;
  result: 'success' | 'failure';
  startedAtMs?: number;
  erpSystem?: string;
}): void {
  const tenant_id = labels.tenantId || 'unknown';
  const result = labels.result;
  const erp_system = normalizeErp(labels.erpSystem);

  safeInc(() => {
    invoicesProcessedTotal.inc({ tenant_id, result, erp_system });

    if (typeof labels.startedAtMs === 'number' && labels.startedAtMs > 0) {
      const seconds = Math.max(0, (Date.now() - labels.startedAtMs) / 1000);
      invoiceProcessingDurationSeconds.observe(
        { tenant_id, result, erp_system },
        seconds
      );
    }
  });
}

/**
 * Record submitted + accepted on the worker when a pipeline chain's first
 * job starts. Keeps all request-monitoring series on the EC2 scrape target
 * (API on Vercel is not scraped).
 */
export function recordInvoiceChainStarted(labels: {
  tenantId: string;
  source?: string;
  eventType: string;
  erpSystem?: string;
}): void {
  recordInvoiceSubmitted({
    tenantId: labels.tenantId,
    source: labels.source || 'unknown',
    eventType: labels.eventType,
    erpSystem: labels.erpSystem,
  });
  recordInvoiceAccepted({
    tenantId: labels.tenantId,
    eventType: labels.eventType,
    erpSystem: labels.erpSystem,
  });
}
