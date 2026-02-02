import mongoose, { Schema, Document } from 'mongoose';

/**
 * Password Reset Token Document Interface
 */
export interface PasswordResetDocument extends Document {
  tenantId: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose Schema for Password Reset Tokens
 */
const PasswordResetSchema = new Schema<PasswordResetDocument>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'password_resets',
  }
);

// TTL index to automatically delete expired tokens after 24 hours
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

// Compound index for efficient lookups
PasswordResetSchema.index({ tokenHash: 1, expiresAt: 1 });

/**
 * Password Reset Model
 */
export const PasswordResetModel =
  mongoose.models.PasswordReset ||
  mongoose.model<PasswordResetDocument>('PasswordReset', PasswordResetSchema);
