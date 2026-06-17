import { Elysia } from 'elysia';
import { WebhookEventType, ErpEventType } from '../../webhook/models';
import {
  listEventsValidation,
  listWorkflowActionsValidation
} from '../validations/reference.validation';

/**
 * Invoice event types extended to cover ERP-originating events
 * in addition to the standard platform events.
 */
export const INVOICE_EVENT_TYPES = [
  // ── Platform lifecycle ───────────────────────────────────────────────────
  {
    id: WebhookEventType.INVOICE_CREATED,
    name: 'Invoice Created',
    category: 'lifecycle',
    direction: 'outbound',
    description: 'A new invoice has been created in the system.',
  },
  {
    id: WebhookEventType.INVOICE_VALIDATED,
    name: 'Invoice Validated',
    category: 'lifecycle',
    direction: 'outbound',
    description: 'Invoice has passed schema and business rule validation.',
  },
  {
    id: WebhookEventType.INVOICE_SIGNED,
    name: 'Invoice Signed',
    category: 'lifecycle',
    direction: 'outbound',
    description: 'Invoice has been digitally signed.',
  },
  {
    id: WebhookEventType.INVOICE_TRANSMITTED,
    name: 'Invoice Transmitted',
    category: 'lifecycle',
    direction: 'outbound',
    description: 'Invoice has been transmitted to FIRS.',
  },
  {
    id: WebhookEventType.INVOICE_DELIVERED,
    name: 'Invoice Delivered',
    category: 'lifecycle',
    direction: 'outbound',
    description: 'Invoice successfully delivered and acknowledged by FIRS.',
  },
  {
    id: WebhookEventType.INVOICE_FAILED,
    name: 'Invoice Failed',
    category: 'lifecycle',
    direction: 'both',
    description: 'Invoice processing failed at any stage.',
  },
  {
    id: WebhookEventType.INVOICE_RECEIVED,
    name: 'Invoice Received',
    category: 'lifecycle',
    direction: 'inbound',
    description: 'An inbound invoice has been received from an external system.',
  },
  {
    id: WebhookEventType.INVOICE_ACKNOWLEDGED,
    name: 'Invoice Acknowledged',
    category: 'lifecycle',
    direction: 'inbound',
    description: 'Inbound invoice has been acknowledged.',
  },
  {
    id: WebhookEventType.INVOICE_PAID,
    name: 'Invoice Paid',
    category: 'payment',
    direction: 'both',
    description: 'Payment has been confirmed for the invoice.',
  },
  {
    id: WebhookEventType.INVOICE_REJECTED,
    name: 'Invoice Rejected',
    category: 'lifecycle',
    direction: 'both',
    description: 'Invoice was rejected by FIRS or the receiving party.',
  },
  {
    id: WebhookEventType.INVOICE_CANCELED,
    name: 'Invoice Canceled',
    category: 'lifecycle',
    direction: 'both',
    description: 'Invoice has been canceled.',
  },
  {
    id: WebhookEventType.TEST_EVENT,
    name: 'Test Event',
    category: 'system',
    direction: 'both',
    description: 'A test event used to verify webhook connectivity.',
  },

  // ── ERP-originating events ───────────────────────────────────────────────
  {
    id: ErpEventType.INVOICE_CREATED,
    name: '<TMP> ERP Invoice Created',
    category: 'erp',
    direction: 'inbound',
    description: 'Invoice created from ERP system into the middleware.',
  },
  {
    id: ErpEventType.INVOICE_SUBMITTED,
    name: 'ERP Invoice Submitted',
    category: 'erp',
    direction: 'inbound',
    description: 'Invoice submitted from ERP system into the middleware.',
  },
  {
    id: ErpEventType.INVOICE_UPDATED,
    name: 'ERP Invoice Updated',
    category: 'erp',
    direction: 'inbound',
    description: 'An existing invoice was updated in the ERP.',
  },
  {
    id: ErpEventType.INVOICE_VOIDED,
    name: 'ERP Invoice Voided',
    category: 'erp',
    direction: 'inbound',
    description: 'Invoice has been voided in the ERP.',
  }, 
  {
    id: ErpEventType.INVOICE_CANCELED,
    name: 'ERP Invoice Canceled',
    category: 'erp',
    direction: 'inbound',
    description: 'Invoice has been canceled in the ERP.',
  },
  {
    id: ErpEventType.PAYMENT_RECEIVED,
    name: 'ERP Payment Received',
    category: 'erp',
    direction: 'inbound',
    description: 'Payment recorded for an invoice in the ERP.',
  },
  {
    id: ErpEventType.CREDIT_NOTE_ISSUED,
    name: 'ERP Credit Note Issued',
    category: 'erp',
    direction: 'inbound',
    description: 'A credit note was issued from the ERP.',
  },
  {
    id: ErpEventType.DEBIT_NOTE_ISSUED,
    name: 'ERP Debit Note Issued',
    category: 'erp',
    direction: 'inbound',
    description: 'A debit note was issued from the ERP.',
  },
] as const;

/**
 * Workflow actions — ordered list for sequential mapping.
 * `order` determines the natural execution sequence.
 */
export const WORKFLOW_ACTIONS = [
  {
    id: 'process_credit_note',
    name: 'Process Credit Note',
    order: 0,
    category: 'outbound',
    description: 'Process credit note by fetching original invoice and adapting it.',
    endpoint: 'POST /api/v1/workflow/credit-note',
  },
  {
    id: 'generate_irn',
    name: 'Generate IRN',
    order: 1,
    category: 'outbound',
    description: 'Generate an Invoice Reference Number (IRN) for the invoice.',
    endpoint: 'POST /api/v1/workflow/irn/generate',
  },
  {
    id: 'transform',
    name: 'Transform',
    order: 2,
    category: 'outbound',
    description: 'Transform the ERP invoice payload into FIRS UBL format.',
    endpoint: 'POST /api/v1/workflow/transform',
  },
  {
    id: 'validate',
    name: 'Validate',
    order: 3,
    category: 'outbound',
    description: 'Validate the transformed invoice against FIRS schema and business rules.',
    endpoint: 'POST /api/v1/workflow/validate',
  },
  {
    id: 'sign',
    name: 'Sign',
    order: 4,
    category: 'outbound',
    description: 'Digitally sign the validated invoice using tenant FIRS credentials.',
    endpoint: 'POST /api/v1/workflow/sign',
  },
  {
    id: 'transmit',
    name: 'Transmit',
    order: 5,
    category: 'outbound',
    description: 'Transmit the signed invoice to the FIRS API.',
    endpoint: 'POST /api/v1/workflow/transmit',
  },
  {
    id: 'complete_outbound',
    name: 'Complete Outbound Flow',
    order: 6,
    category: 'outbound',
    description: 'Execute the full outbound pipeline: Transform → Validate → Sign → Transmit in one call.',
    endpoint: 'POST /api/v1/workflow/outbound',
  },
  {
    id: 'complete_inbound',
    name: 'Complete Inbound Flow',
    order: 7,
    category: 'inbound',
    description: 'Execute the full inbound pipeline: receive, validate, and acknowledge an inbound invoice.',
    endpoint: 'POST /api/v1/workflow/inbound',
  },
  {
    id: 'report_vat',
    name: 'Report VAT',
    order: 8,
    category: 'reporting',
    description: 'Submit VAT report for the invoice or reporting period to FIRS.',
    endpoint: 'POST /api/v1/workflow/vat-report',
  },
  {
    id: 'confirm_invoice_status',
    name: 'Confirm Invoice Status',
    order: 9,
    category: 'reporting',
    description: 'Query FIRS to confirm the current status of a transmitted invoice.',
    endpoint: 'GET /api/v1/workflow/status/:irn',
  },
  {
    id: 'update_payment_status',
    name: 'Update Payment Status',
    order: 10,
    category: 'reporting',
    description: 'Submit VAT post-payment report to FIRS after payment is recorded on a DELIVERED invoice.',
    endpoint: 'PATCH /api/v1/workflow/invoices/outbound/:irn/payment-status',
  },
  {
    id: 'sync_erp',
    name: 'Sync to ERP',
    order: 11,
    category: 'outbound',
    description: 'Push processed invoice data back to the tenant ERP using the configured sync endpoint and Handlebars body template.',
    endpoint: 'POST /api/v1/workflow/erp-sync',
  },
] as const;

/**
 * Reference Data Routes
 * Public config endpoints for the frontend to discover available
 * event types and workflow actions.
 */
export const referenceRoutes = new Elysia({ prefix: '/config/reference' })

  /**
   * GET /admin/config/reference/events
   * Returns all invoice event types with category and direction metadata.
   * Supports optional filtering by category or direction.
   */
  .get(
    '/events',
    ({ query }) => {
      let events: typeof INVOICE_EVENT_TYPES[number][] = [...INVOICE_EVENT_TYPES]; 
      if (query.category && query.category !== "all") { 
        events = events.filter((e) => e.category === query.category);
      }
      if (query.direction && query.direction !== 'all') {
        events = events.filter(
          (e) => e.direction === query.direction || e.direction === 'both'
        );
      }

      
      return {
        success: true,
        data: {
          events, 
          total: events.length,
        },
      };
    },
    listEventsValidation
  )

  /**
   * GET /admin/config/reference/workflow-actions
   * Returns all workflow actions in execution order.
   * Supports optional filtering by category.
   */
  .get(
    '/workflow-actions',
    ({ query }) => {
      let actions: typeof WORKFLOW_ACTIONS[number][] = [...WORKFLOW_ACTIONS];

      if (query.category && query.category !=='all') {
        actions = actions.filter((a) => a.category === query.category);
      }

      // Always return sorted by order
      const sorted = actions.slice().sort((a, b) => a.order - b.order);

      
      return {
        success: true,
        data: {
          actions: sorted, 
          total: sorted.length,
        },
      };
    },
    listWorkflowActionsValidation
  );
