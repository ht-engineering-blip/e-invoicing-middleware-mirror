import { t } from 'elysia';

/**
 * Invoice Workflow Validators
 * Elysia validators for invoice workflow API endpoints
 */

/**
 * Invoice Line Item Validator
 */
export const invoiceLineItemValidator = t.Object({
  description: t.String({ minLength: 1, maxLength: 500 }),
  quantity: t.Number({ minimum: 0.01 }),
  unitPrice: t.Number({ minimum: 0 }),
  taxRate: t.Number({ minimum: 0, maximum: 100 }),
  taxAmount: t.Optional(t.Number({ minimum: 0 })),
  lineTotal: t.Optional(t.Number({ minimum: 0 })),
});

/**
 * Submit Outbound Invoice Validator
 */
export const submitOutboundInvoiceValidator = t.Object({
  invoiceNumber: t.String({ minLength: 1, maxLength: 100 }),
  customerName: t.String({ minLength: 2, maxLength: 200 }),
  customerTIN: t.String({ minLength: 10, maxLength: 20 }),
  issueDate: t.String({ format: 'date' }),
  dueDate: t.String({ format: 'date' }),
  currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
  lineItems: t.Array(invoiceLineItemValidator, { minItems: 1 }),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
});

/**
 * IRN Path Parameter Validator
 */
export const irnParamValidator = t.Object({
  irn: t.String({ minLength: 5, maxLength: 100 }),
});

/**
 * Invoice Status Query Validator
 */
export const invoiceStatusQueryValidator = t.Object({
  includeHistory: t.Optional(t.Boolean()),
  includeWebhooks: t.Optional(t.Boolean()),
});

/**
 * List Outbound Invoices Query Validator
 */
export const listOutboundInvoicesQueryValidator = t.Object({
  page: t.Optional(t.Number({ minimum: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  status: t.Optional(
    t.Union([
      t.Literal('CREATED'),
      t.Literal('VALIDATED'),
      t.Literal('SIGNED'),
      t.Literal('TRANSMITTED'),
      t.Literal('DELIVERED'),
      t.Literal('FAILED'),
    ])
  ),
  startDate: t.Optional(t.String({ format: 'date' })),
  endDate: t.Optional(t.String({ format: 'date' })),
  customerTIN: t.Optional(t.String()),
  invoiceNumber: t.Optional(t.String()),
  sortBy: t.Optional(t.String()),
  sortOrder: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
});

/**
 * Acknowledge Inbound Invoice Validator
 */
export const acknowledgeInboundInvoiceValidator = t.Object({
  acknowledgmentNote: t.Optional(t.String({ maxLength: 1000 })),
});

/**
 * Update Invoice Payment Validator
 */
export const updateInvoicePaymentValidator = t.Object({
  status: t.Union([t.Literal('PAID'), t.Literal('REJECTED'), t.Literal('CANCELED')]),
  paymentDetails: t.Optional(
    t.Object({
      paymentDate: t.String({ format: 'date' }),
      paymentMethod: t.String({ minLength: 2, maxLength: 100 }),
      transactionReference: t.String({ minLength: 5, maxLength: 200 }),
      amountPaid: t.Number({ minimum: 0 }),
    })
  ),
  rejectionReason: t.Optional(t.String({ minLength: 10, maxLength: 1000 })),
});

/**
 * Sync Invoice to ERP Validator
 */
export const syncInvoiceToErpValidator = t.Object({
  irn: t.String({ minLength: 5, maxLength: 100 }),
  invoiceData: t.Any(),
  erpInvoiceNumber: t.Optional(t.String()),
});

/**
 * List Inbound Invoices Query Validator
 */
export const listInboundInvoicesQueryValidator = t.Object({
  page: t.Optional(t.Number({ minimum: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  status: t.Optional(
    t.Union([
      t.Literal('TRANSMITTED'),
      t.Literal('ACKNOWLEDGED'),
      t.Literal('DOWNLOADED'),
      t.Literal('SYNCED_TO_ERP'),
      t.Literal('PAID'),
      t.Literal('REJECTED'),
      t.Literal('CANCELED'),
    ])
  ),
  startDate: t.Optional(t.String({ format: 'date' })),
  endDate: t.Optional(t.String({ format: 'date' })),
  supplierTIN: t.Optional(t.String()),
  paymentStatus: t.Optional(
    t.Union([
      t.Literal('PENDING'),
      t.Literal('PAID'),
      t.Literal('PARTIAL'),
      t.Literal('OVERDUE'),
    ])
  ),
  sortBy: t.Optional(t.String()),
  sortOrder: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
});

/**
 * Retry Failed Invoice Validator
 */
export const retryFailedInvoiceValidator = t.Object({
  retryType: t.Union([
    t.Literal('validation'),
    t.Literal('transformation'),
    t.Literal('transmission'),
  ]),
  forceRetry: t.Optional(t.Boolean()),
});
