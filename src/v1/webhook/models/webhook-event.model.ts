import mongoose, { Schema, Document } from 'mongoose';



/**
 * Webhook Event Type
 */
export enum WebhookEventType {
  TEST_EVENT = 'test.event',
  INVOICE_CREATED = 'invoice.created',
  INVOICE_VALIDATED = 'invoice.validated',
  INVOICE_SIGNED = 'invoice.signed',
  INVOICE_TRANSMITTED = 'invoice.transmitted',
  INVOICE_DELIVERED = 'invoice.delivered',
  INVOICE_FAILED = 'invoice.failed',
  INVOICE_RECEIVED = 'invoice.received',
  INVOICE_ACKNOWLEDGED = 'invoice.acknowledged',
  INVOICE_PAID = 'invoice.paid',
  INVOICE_REJECTED = 'invoice.rejected',
  INVOICE_CANCELED = 'invoice.canceled',
}

/**
 * Webhook Delivery Status
 */
export enum WebhookDeliveryStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  RETRY = 'retry',
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
  eventType: WebhookEventType;

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
      enum: Object.values(WebhookEventType),
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
      index: true,
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
      index: true,
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

    // Metadata
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'webhook_events',
  }
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
  mongoose.model<WebhookEventDocument>('WebhookEvent', WebhookEventSchema);
