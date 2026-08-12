import mongoose, { Schema, Document } from 'mongoose';

/**
 * Audit Event Type
 */
export enum AuditEventType {
  // Tenant Events
  TENANT_CREATED = 'tenant.created',
  TENANT_UPDATED = 'tenant.updated',
  TENANT_ACTIVATED = 'tenant.activated',
  TENANT_SUSPENDED = 'tenant.suspended',
  TENANT_DELETED = 'tenant.deleted',

  // Invoice Events
  INVOICE_SUBMITTED = 'invoice.submitted',
  INVOICE_TRANSFORMED = 'invoice.transformed',
  INVOICE_VALIDATED = 'invoice.validated',
  INVOICE_SIGNED = 'invoice.signed',
  INVOICE_TRANSMITTED = 'invoice.transmitted',
  INVOICE_DELIVERED = 'invoice.delivered',
  INVOICE_FAILED = 'invoice.failed',
  INVOICE_RECEIVED = 'invoice.received',
  INVOICE_ACKNOWLEDGED = 'invoice.acknowledged',
  INVOICE_DOWNLOADED = 'invoice.downloaded',
  INVOICE_SYNCED = 'invoice.synced',
  INVOICE_PAID = 'invoice.paid',
  INVOICE_REJECTED = 'invoice.rejected',

  // API Key Events
  API_KEY_CREATED = 'api_key.created',
  API_KEY_USED = 'api_key.used',
  API_KEY_REVOKED = 'api_key.revoked',

  // Authentication Events
  AUTH_LOGIN_SUCCESS = 'auth.login.success',
  AUTH_LOGIN_FAILED = 'auth.login.failed',
  AUTH_LOGOUT = 'auth.logout',
  AUTH_TOKEN_EXPIRED = 'auth.token.expired',

  // FIRS Integration Events
  FIRS_API_CALL = 'firs.api.call',
  FIRS_API_SUCCESS = 'firs.api.success',
  FIRS_API_ERROR = 'firs.api.error',

  // System Events
  SYSTEM_ERROR = 'system.error',
  SYSTEM_WARNING = 'system.warning',
}

/**
 * Audit Event Severity
 */
export enum AuditEventSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * Actor Information Interface
 */
export interface IActor {
  actorType: 'user' | 'system' | 'tenant' | 'api_key';
  actorId: string;
  actorName?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * MongoDB Document interface for Audit Log
 */
export interface AuditLogDocument extends Document {
  tenantId?: string; 
  eventId: string;
  eventType: AuditEventType;
  severity: AuditEventSeverity;

  // Actor Information
  actor: IActor;

  // Event Details
  resource: {
    resourceType: string;
    resourceId: string;
    resourceName?: string;
  } | string; 
  description: string;

  // Event Data
  changes?: {
    before?: any;
    after?: any;
  };
  metadata: Record<string, any>;

  // Request Information
  requestId?: string;
  requestMethod?: string;
  requestPath?: string;
  requestBody?: any;
  responseStatus?: number;
  responseBody?: any;
  duration?: number;

  // Error Information
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };

  // Timestamps
  timestamp: Date;
  createdAt: Date;

  // Cryptographic integrity fields
  hash?: string;
  previousHash?: string;
}

/**
 * Mongoose Schema for Audit Log collection
 */
const AuditLogSchema = new Schema<AuditLogDocument>(
  {
    tenantId: {
      type: String,
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
      enum: Object.values(AuditEventType),
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: Object.values(AuditEventSeverity),
      required: true,
      index: true,
    },

    // Actor Information
    actor: {
      actorType: {
        type: String,
        enum: ['user', 'system', 'tenant', 'api_key'],
        required: true,
      },
      actorId: { type: String, required: true },
      actorName: { type: String },
      ipAddress: { type: String },
      userAgent: { type: String },
    },

    // Event Details
    resource: {
      resourceType: { type: String, required: true },
      resourceId: { type: String, required: true, index: true },
      resourceName: { type: String },
    },
   
    description: {
      type: String,
      required: true,
    },

    // Event Data
    changes: {
      before: { type: Schema.Types.Mixed },
      after: { type: Schema.Types.Mixed },
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // Request Information
    requestId: {
      type: String,
      index: true,
    },
    requestMethod: {
      type: String,
    },
    requestPath: {
      type: String,
    },
    requestBody: {
      type: Schema.Types.Mixed,
    },
    responseStatus: {
      type: Number,
    },
    responseBody: {
      type: Schema.Types.Mixed,
    },
    duration: {
      type: Number,
    },

    // Error Information
    error: {
      message: { type: String },
      code: { type: String },
      stack: { type: String },
    },

    // Timestamps
    timestamp: {
      type: Date,
      default: Date.now,
      // Note: index defined below with TTL expireAfterSeconds option
    },

    // Cryptographic integrity fields
    hash: {
      type: String,
      index: true,
    },
    previousHash: {
      type: String,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'audit_logs',
  }
);

// Compound Indexes for performance and queries
AuditLogSchema.index({ tenantId: 1, eventType: 1 });
AuditLogSchema.index({ tenantId: 1, timestamp: -1 });
AuditLogSchema.index({ eventType: 1, timestamp: -1 });
AuditLogSchema.index({ 'resource.resourceId': 1, timestamp: -1 });
AuditLogSchema.index({ 'actor.actorId': 1, timestamp: -1 });
AuditLogSchema.index({ severity: 1, timestamp: -1 });

// TTL Index for automatic deletion after 7 years (compliance requirement)
AuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 220752000 }); // 7 years

/**
 * Audit Log Model
 */
export const AuditLogModel =
  mongoose.models.AuditLog || mongoose.model<AuditLogDocument>('AuditLog', AuditLogSchema);
