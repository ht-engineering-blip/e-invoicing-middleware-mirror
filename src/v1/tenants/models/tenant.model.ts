import mongoose, { Schema, Document } from 'mongoose';
import { SchemaSourceType } from '../../workflow/models';


/**
 * Tenant Status
 */
export enum TenantStatus {
  ONBOARDING = 'onboarding',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  INACTIVE = 'inactive',
}

/**
 * ERP Sync Configuration Interface
 */
export interface IERPSyncConfig {
  name: string;
  description?: string;
  enabled: boolean;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  baseUrl: string;
  endpoint: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyTemplate?: string;
  authentication?: {
    type: 'none' | 'basic' | 'bearer' | 'api-key' | 'oauth2';
    username?: string;
    password?: string;
    token?: string;
    apiKeyName?: string;
    apiKeyValue?: string;
    apiKeyLocation?: 'header' | 'query';
  };
  timeout?: number;
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
    retryOn?: number[];
  };
  responseMapping?: Record<string, string>;
  triggerEvents?: string[];
}

/**
 * Tenant Configuration Interface
 */
export interface ITenantConfig {
  firsCredentials?: {
    clientId?: string;
    serviceId?: string;
    certificate?: string;
    publicKey?: string;
    apiKey?: string;
    apiSecret?: string;
  };
  erpSyncConfig?: IERPSyncConfig;
  erpSystem: SchemaSourceType | string;
  webhookUrl?: string;
  webhookAuth?: string;
  webhookEnabled?: boolean;
  webhookExpiresAt?: Date;
  webhookLifespan?: string;
  invoiceIdKey?: string;
  idKeyMap?: Record<string, string>;
  referenceIdKeyMap?: Record<string, string>;
  features?: {
    autoFix: boolean;
    maxRetries: number;
    qrCodeGeneration: boolean;
  };
  limits?: {
    monthlyInvoiceLimit: number;
    apiRateLimit: number;
  };
}

/**
 * MongoDB Document interface for Tenant
 */
export interface TenantDocument extends Document {
  tenantId: string;
  businessId?: string;
  businessRegistrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  password: string;
  erpSystem: SchemaSourceType | string;
  expectedVolume: Number;
  webhookUrl: String,
  webhookAuth: String,
  webhookEnabled: Boolean,
  webhookExpiresAt?: Date;
  webhookLifespan?: string;

  businessName: string;
  tin: string;
  status: TenantStatus;
  passwordChangedAt?: Date;
  config?: ITenantConfig;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  metadata: Record<string, any>;
}

/**
 * Mongoose Schema for Tenant collection
 */
const TenantSchema = new Schema<TenantDocument>(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
    },
    businessId: {
      type: String,
      index: true,
      sparse: true,
    },
    businessRegistrationNumber: {
      type: String,
      required: true,
      unique: true,
    },
    contactEmail: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String
    },
    contactPhone: {
      type: String,
      required: true,
    },
    expectedVolume: {
      type: Number,
      required: true,
    },
    businessName: {
      type: String,
      required: true,
    },
    tin: {
      type: String,
      required: true,
    },
    passwordChangedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: Object.values(TenantStatus),
      default: TenantStatus.ONBOARDING,
    },
    config: {
      firsCredentials: {
        clientId: { type: String },
        serviceId: { type: String },
        certificate: { type: String },
        publicKey: { type: String },
        apiKey: { type: String },
        apiSecret: { type: String }
      },
      erpSyncConfig: {
        name: { type: String },
        description: { type: String },
        enabled: { type: Boolean, default: true },
        method: { type: String, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        baseUrl: { type: String },
        endpoint: { type: String },
        headers: { type: Map, of: String },
        queryParams: { type: Map, of: String },
        bodyTemplate: { type: String },
        authentication: {
          type: { type: String, enum: ['none', 'basic', 'bearer', 'api-key', 'oauth2'] },
          username: { type: String },
          password: { type: String },
          token: { type: String },
          apiKeyName: { type: String },
          apiKeyValue: { type: String },
          apiKeyLocation: { type: String, enum: ['header', 'query'] },
        },
        timeout: { type: Number, default: 30000 },
        retryConfig: {
          maxRetries: { type: Number, default: 3 },
          retryDelay: { type: Number, default: 1000 },
          retryOn: [{ type: Number }],
        },
        responseMapping: { type: Map, of: String },
        triggerEvents: [{ type: String }],
      },
      erpSystem: {
        type: String, 
        required: true,
      },
      webhookUrl: { type: String },
      webhookAuth: { type: String },
      webhookEnabled: { type: Boolean, default: false },
      webhookExpiresAt: { type: Date },
      webhookLifespan: { type: String },
      invoiceIdKey: { type: String },
      idKeyMap: { type: Map, of: String },
      referenceIdKeyMap: { type: Map, of: String },
      features: {
        autoFix: { type: Boolean, default: true },
        maxRetries: { type: Number, default: 5 },
        qrCodeGeneration: { type: Boolean, default: true },
      },
      limits: {
        monthlyInvoiceLimit: { type: Number, default: 10000 },
        apiRateLimit: { type: Number, default: 100 },
      },
    },
    createdBy: {
      type: String
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'tenants',
  }
);

// Indexes for performance (tenantId already has unique: true in schema)
TenantSchema.index({ tin: 1 });
TenantSchema.index({ status: 1 });

/**
 * Tenant Model
 */
export const TenantModel =
  mongoose.models.Tenant || mongoose.model<TenantDocument>('Tenant', TenantSchema);
