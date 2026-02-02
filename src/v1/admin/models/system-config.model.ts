import mongoose, { Schema, Document } from 'mongoose';

/**
 * System Configuration Keys
 */
export enum SystemConfigKey {
  FIRS_DICTIONARY = 'firs_dictionary',
  SUPPORTED_ERPS = 'supported_erps',
  WEBHOOK_SETTINGS = 'webhook_settings',
  RATE_LIMITS = 'rate_limits',
  FEATURE_FLAGS = 'feature_flags',
}

/**
 * ERP Configuration Interface
 */
export interface IERPConfiguration {
  type: string;
  name: string;
  description?: string;
  schema: Record<string, any>;
  sampleInvoice?: Record<string, any>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * System Configuration Document Interface
 */
export interface SystemConfigDocument extends Document {
  configKey: string;
  configValue: any;
  description: string;
  isActive: boolean;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose Schema for System Configuration
 */
const SystemConfigSchema = new Schema<SystemConfigDocument>(
  {
    configKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    configValue: {
      type: Schema.Types.Mixed,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    createdBy: {
      type: String,
      default: 'system',
    },
    updatedBy: {
      type: String,
      default: 'system',
    },
  },
  {
    timestamps: true,
    collection: 'system_configs',
  }
);

// Indexes
SystemConfigSchema.index({ configKey: 1, isActive: 1 });

/**
 * System Configuration Model
 */
export const SystemConfigModel =
  mongoose.models.SystemConfig ||
  mongoose.model<SystemConfigDocument>('SystemConfig', SystemConfigSchema);
