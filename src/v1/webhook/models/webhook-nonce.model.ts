import mongoose, { Schema, Document } from 'mongoose';

export interface WebhookNonceDocument extends Document {
  tenantId: string;
  t: number;
  v1: string;
  createdAt: Date;
}

const WebhookNonceSchema = new Schema<WebhookNonceDocument>(
  {
    tenantId: {
      type: String,
      required: true,
    },
    t: {
      type: Number,
      required: true,
    },
    v1: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    collection: 'webhook_nonces',
  }
);

// Compound unique index on tenantId, t, v1
WebhookNonceSchema.index({ tenantId: 1, t: 1, v1: 1 }, { unique: true });

// TTL index on createdAt to auto-prune nonces after 300 seconds (5 minutes)
WebhookNonceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 300 });

export const WebhookNonceModel =
  mongoose.models.WebhookNonce ||
  mongoose.model<WebhookNonceDocument>('WebhookNonce', WebhookNonceSchema);
