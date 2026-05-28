import { t } from 'elysia';

export const listOutboundInvoicesValidation = {
  query: t.Object({
    page: t.Optional(t.String()),
    limit: t.Optional(t.String()),
    status: t.Optional(t.String()),
    source: t.Optional(t.String()),
    erpInvoiceId: t.Optional(t.String()),
    from: t.Optional(t.String()),
    to: t.Optional(t.String()),
  }),
  detail: {
    tags: ['Transaction Logs'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'List Outbound Invoices',
    description: 'List outbound invoices with filtering and pagination. Filter by source=webhook|api or erpInvoiceId.',
  },
};

export const getOutboundInvoiceValidation = {
  params: t.Object({ irn: t.String() }),
  detail: {
    tags: ['Transaction Logs'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Get Outbound Invoice',
    description: 'Get outbound invoice with populated webhook events, job error timeline, and payment status',
  },
};

export const updatePaymentStatusValidation = {
  params: t.Object({ irn: t.String() }),
  body: t.Object({
    paymentStatus: t.Union([
      t.Literal('PAID'), t.Literal('PARTIAL'), t.Literal('OVERDUE'),
    ]),
    paymentDetails: t.Optional(t.Object({
      paymentDate: t.Optional(t.String()),
      paymentMethod: t.Optional(t.String()),
      transactionReference: t.Optional(t.String()),
      amountPaid: t.Optional(t.Number()),
    })),
  }),
  detail: {
    tags: ['Transaction Logs'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Update Payment Status',
    description: 'Update outbound invoice payment status. Automatically schedules report_vat when status is PAID and invoice is DELIVERED.',
  },
};

export const retryInvoiceFromStepValidation = {
  params: t.Object({ irn: t.String() }),
  body: t.Object({
    fromStep: t.String({
      description: 'Action name to resume from (e.g. "validate", "sign", "transmit")',
    }),
  }),
  detail: {
    tags: ['Transaction Logs'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Retry Invoice From Step',
    description: 'Resume a failed invoice job chain from a specific workflow step.',
  },
};

export const resendFailedInvoiceValidation = {
  params: t.Object({
    irn: t.String(),
  }),
  detail: {
    tags: ['Transaction Logs'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Resend Failed Invoice',
    description: 'Restart workflow for a failed invoice',
  },
};

export const listInboundInvoicesValidation = {
  query: t.Object({
    page: t.Optional(t.String()),
    limit: t.Optional(t.String()),
    status: t.Optional(t.String()),
    paymentStatus: t.Optional(t.String()),
    from: t.Optional(t.String()),
    to: t.Optional(t.String()),
  }),
  detail: {
    tags: ['Transaction Logs'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'List Inbound Invoices',
    description: 'List inbound invoices with filtering and pagination',
  },
};

export const getInboundInvoiceValidation = {
  params: t.Object({
    irn: t.String(),
  }),
  detail: {
    tags: ['Transaction Logs'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Get Inbound Invoice',
    description: 'Get inbound invoice with full details and status history',
  },
};
