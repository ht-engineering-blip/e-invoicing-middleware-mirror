import mongoose, { Schema, Document } from 'mongoose';

/**
 * API Key Status
 */
export enum ApiKeyStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

/**
 * MongoDB Document interface for API Key
 */
export interface ApiKeyDocument extends Document {
  tenantId: string; 
  keyHash: string;
  keyPrefix: string;
  name: string;
  description?: string;
  status: ApiKeyStatus;

  // Permissions & Scopes
  scopes: string[];

  // Usage tracking
  lastUsedAt?: Date;
  usageCount: number;

  // Expiration
  expiresAt?: Date;

  // Metadata
  createdAt: Date;
  updatedAt: Date; 
  revokedAt?: Date;
  revokedBy?: string;
  revokedReason?: string;
}

/**
 * Mongoose Schema for API Key collection
 */
const ApiKeySchema = new Schema<ApiKeyDocument>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    }, 
    keyHash: {
      type: String,
      required: true
    },
    keyPrefix: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    status: {
      type: String,
      enum: Object.values(ApiKeyStatus),
      default: ApiKeyStatus.ACTIVE,
      index: true,
    },

    // Permissions & Scopes
    scopes: [
      {
        type: String,
      },
    ],

    // Usage tracking
    lastUsedAt: {
      type: Date,
    },
    usageCount: {
      type: Number,
      default: 0,
    },

    // Expiration
    expiresAt: {
      type: Date
    },

    // Metadata
    revokedAt: {
      type: Date,
    },
    revokedBy: {
      type: String,
    },
    revokedReason: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'api_keys',
  }
);

// Compound Indexes for performance
ApiKeySchema.index({ tenantId: 1, status: 1 });
ApiKeySchema.index({ keyHash: 1 }, { unique: true });
ApiKeySchema.index({ keyPrefix: 1 });
ApiKeySchema.index({ expiresAt: 1 });

/**
 * API Key Model
 */
export const ApiKeyModel =
  mongoose.models.ApiKey || mongoose.model<ApiKeyDocument>('ApiKey', ApiKeySchema);
