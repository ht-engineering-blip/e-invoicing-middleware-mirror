import { t } from 'elysia';

/**
 * Webhook Validators
 * Elysia validators for webhook-related API endpoints
 */

/**
 * FIRS Invoice Notification Webhook Validator
 */
export const firsInvoiceNotificationValidator = t.Object({
  irn: t.String({ minLength: 5, maxLength: 100 }),
  supplierTIN: t.String({ minLength: 10, maxLength: 20 }),
  customerTIN: t.String({ minLength: 10, maxLength: 20 }),
  invoiceNumber: t.String({ minLength: 1, maxLength: 100 }),
  issueDate: t.String({ format: 'date' }),
  totalAmount: t.Number({ minimum: 0 }),
  currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
});

/**
 * FIRS Status Update Webhook Validator
 */
export const firsStatusUpdateValidator = t.Object({
  irn: t.String({ minLength: 5, maxLength: 100 }),
  status: t.String(),
  statusMessage: t.Optional(t.String()),
  timestamp: t.String({ format: 'date-time' }),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
});

/**
 * Webhook Event ID Path Parameter Validator
 */
export const webhookEventIdParamValidator = t.Object({
  eventId: t.String(),
});

/**
 * List Webhook Events Query Validator
 */
export const listWebhookEventsQueryValidator = t.Object({
  page: t.Optional(t.Number({ minimum: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  eventType: t.Optional(t.String()),
  status: t.Optional(
    t.Union([
      t.Literal('pending'),
      t.Literal('delivered'),
      t.Literal('failed'),
      t.Literal('retry'),
    ])
  ),
  resourceId: t.Optional(t.String()),
  startDate: t.Optional(t.String({ format: 'date' })),
  endDate: t.Optional(t.String({ format: 'date' })),
  sortBy: t.Optional(t.String()),
  sortOrder: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
});

/**
 * Retry Webhook Delivery Validator
 */
export const retryWebhookValidator = t.Object({
  forceRetry: t.Optional(t.Boolean()),
  webhookUrl: t.Optional(t.String({ format: 'uri' })),
});

/**
 * Test Webhook Endpoint Validator
 */
export const testWebhookValidator = t.Object({
  webhookUrl: t.String({ format: 'uri' }),
  eventType: t.String(),
  testPayload: t.Optional(t.Record(t.String(), t.Any())),
});

/**
 * Configure Webhook Settings Validator
 */
export const configureWebhookValidator = t.Object({
  webhookUrl: t.String({ format: 'uri' }),
  webhookAuth: t.String({ minLength: 20 }),
  webhookEnabled: t.Boolean(),
  eventTypes: t.Optional(t.Array(t.String())),
  retryConfig: t.Optional(
    t.Object({
      maxRetries: t.Number({ minimum: 1, maximum: 10 }),
      retryDelaySeconds: t.Number({ minimum: 1, maximum: 3600 }),
    })
  ),
});

/**
 * Webhook Signature Validator (for FIRS webhooks)
 */
export const webhookSignatureHeaderValidator = t.Object({
  'x-firs-signature': t.String(),
  'x-firs-timestamp': t.String(),
});
