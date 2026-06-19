import mongoose, { Schema, Document } from "mongoose";

/**
 * Webhook Event Type
 */
export enum WebhookEventType {
  TEST_EVENT = "test.event",
  INVOICE_CREATED = "invoice.created",
  INVOICE_VALIDATED = "invoice.validated",
  INVOICE_SIGNED = "invoice.signed",
  INVOICE_TRANSMITTED = "invoice.transmitted",
  INVOICE_DELIVERED = "invoice.delivered",
  INVOICE_FAILED = "invoice.failed",
  INVOICE_RECEIVED = "invoice.received",
  INVOICE_ACKNOWLEDGED = "invoice.acknowledged",
  INVOICE_PAID = "invoice.paid",
  INVOICE_REJECTED = "invoice.rejected",
  INVOICE_CANCELED = "invoice.canceled",
}

/**
 * ERP Event Type
 */
export enum ErpEventType {
  INVOICE_CREATED = "erp.invoice.created",
  INVOICE_SUBMITTED = "erp.invoice.submitted",
  INVOICE_UPDATED = "erp.invoice.updated",
  INVOICE_VOIDED = "erp.invoice.voided",
  INVOICE_CANCELED = "erp.invoice.canceled",
  PAYMENT_RECEIVED = "erp.payment.received",
  CREDIT_NOTE_ISSUED = "erp.creditnote.issued",
  DEBIT_NOTE_ISSUED = "erp.debitnote.issued",
}

/**
 * Webhook Delivery Status
 */
export enum WebhookDeliveryStatus {
  PENDING = "pending",
  DELIVERED = "delivered",
  FAILED = "failed",
  RETRY = "retry",
}

/**
 * Per-step job failure recorded when a chain step throws
 */
export interface IJobError {
  step: number;
  action: string;
  jobChainId: string;
  agendaJobId?: string;
  error: string;
  failedAt: Date;
}

/**
 * Webhook Delivery Attempt Interface
 */
export interface IWebhookDeliveryAttempt {
  attemptNumber: number;
  timestamp: Date;
  httpStatus?: number;
  responseBody?: any;
  error?: string;
  duration: number;
}

/**
 * MongoDB Document interface for Webhook Event
 */
export interface WebhookEventDocument extends Document {
  tenantId: string;
  eventId: string;
  eventType: string;

  // Event Data
  payload: any;
  resourceId: string;
  resourceType: string;

  // Delivery Information
  webhookUrl: string;
  status: WebhookDeliveryStatus;
  deliveryAttempts: IWebhookDeliveryAttempt[];
  maxRetries: number;
  nextRetryAt?: Date;

  // Response Information
  finalHttpStatus?: number;
  finalResponseBody?: any;
  deliveredAt?: Date;
  failedAt?: Date;
  failureReason?: string;

  // Job chain error history
  jobErrors: IJobError[];

  // Agenda job IDs for every step scheduled in this chain (for tracing)
  jobIds: string[];

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, any>;
}

/**
 * Mongoose Schema for Webhook Event collection
 */
const WebhookEventSchema = new Schema<WebhookEventDocument>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },

    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },

    // Event Data
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    resourceId: {
      type: String,
      required: true,
    },
    resourceType: {
      type: String,
      required: true,
    },

    // Delivery Information
    webhookUrl: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(WebhookDeliveryStatus),
      default: WebhookDeliveryStatus.PENDING,
      index: true,
    },
    deliveryAttempts: [
      {
        attemptNumber: { type: Number, required: true },
        timestamp: { type: Date, default: Date.now },
        httpStatus: { type: Number },
        responseBody: { type: Schema.Types.Mixed },
        error: { type: String },
        duration: { type: Number, required: true },
      },
    ],
    maxRetries: {
      type: Number,
      default: 3,
    },
    nextRetryAt: {
      type: Date,
    },

    // Response Information
    finalHttpStatus: {
      type: Number,
    },
    finalResponseBody: {
      type: Schema.Types.Mixed,
    },
    deliveredAt: {
      type: Date,
    },
    failedAt: {
      type: Date,
    },
    failureReason: {
      type: String,
    },

    // Job chain error history
    jobErrors: [
      {
        step: { type: Number, required: true },
        action: { type: String, required: true },
        jobChainId: { type: String, required: true },
        agendaJobId: { type: String },
        error: { type: String, required: true },
        failedAt: { type: Date, default: Date.now },
      },
    ],

    // Agenda job IDs for every step in this chain
    jobIds: [{ type: String }],

    // Metadata
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: "webhook_events",
  },
);

// Compound Indexes for performance
WebhookEventSchema.index({ tenantId: 1, eventType: 1 });
WebhookEventSchema.index({ tenantId: 1, status: 1 });
WebhookEventSchema.index({ resourceId: 1 });
WebhookEventSchema.index({ createdAt: -1 });
WebhookEventSchema.index({ nextRetryAt: 1 }, { sparse: true });

/**
 * Webhook Event Model
 */
export const WebhookEventModel =
  mongoose.models.WebhookEvent ||
  mongoose.model<WebhookEventDocument>("WebhookEvent", WebhookEventSchema);
