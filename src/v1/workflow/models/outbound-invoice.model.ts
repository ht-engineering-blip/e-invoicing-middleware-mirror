import mongoose, { Schema, Document } from 'mongoose';
import { SchemaSourceType } from './invoice-schema-dictionary.model';
import { WebhookEventDocument } from '../../webhook/models';
/**
 * Outbound Invoice Status
 */
export enum OutboundInvoiceStatus {
  CREATED = 'CREATED',
  VALIDATED = 'VALIDATED',
  SIGNED = 'SIGNED',
  TRANSMITTED = 'TRANSMITTED',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
}

/**
 * Invoice Line Item Interface
 */
export interface IInvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

/**
 * Workflow State Interface
 */
export interface IWorkflowState {
  transformed: boolean;
  validated: boolean;
  signed: boolean;
  transmitted: boolean;
  delivered: boolean;
}

/**
 * Validation Error Interface
 */
export interface IValidationError {
  attempt: number;
  errors: string[];
  fixed: boolean;
}



/**
 * MongoDB Document interface for Outbound Invoice
 */
export interface OutboundInvoiceDocument extends Document {
  tenantId: string;
  irn: string;

  // Status & Workflow
  status: OutboundInvoiceStatus;
  workflowState: IWorkflowState;

  //FIRS resp
  qrCode: String
  // Validation
  validationAttempts: number;
  validationErrors?: IValidationError[];

  // Audit Trail
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  webhookEvents: WebhookEventDocument[];

  // Metadata
  erpSystem: SchemaSourceType| string;
  metadata: Record<string, any>;
}

/**
 * Mongoose Schema for Outbound Invoice collection
 */
const OutboundInvoiceSchema = new Schema<OutboundInvoiceDocument>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    irn: {
      type: String,
      required: true 
    },


    // Status & Workflow
    status: {
      type: String,
      enum: Object.values(OutboundInvoiceStatus),
      default: OutboundInvoiceStatus.CREATED,
      index: true,
    },
    workflowState: {
      transformed: { type: Boolean, default: false },
      validated: { type: Boolean, default: false },
      signed: { type: Boolean, default: false },
      transmitted: { type: Boolean, default: false },
      delivered: { type: Boolean, default: false },
    },


    // Validation
    validationAttempts: {
      type: Number,
      default: 0,
    },
    validationErrors: [
      {
        attempt: { type: Number, required: true },
        errors: [{ type: String }],
        fixed: { type: Boolean, default: false },
      },
    ],

    // Audit Trail
    createdBy: {
      type: String,
      required: true,
    },
    webhookEvents: [
      {
        eventType: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        payload: { type: Schema.Types.Mixed },
        response: { type: Schema.Types.Mixed },
        success: { type: Boolean, required: true },
      },
    ],
    // FIRS resp
    qrCode: { type: String },
    // Metadata
    erpSystem: {
      type: String, 
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'outbound_invoices',
    suppressReservedKeysWarning: true,
  }
);

// Compound Indexes for performance
OutboundInvoiceSchema.index({ tenantId: 1, status: 1 });
OutboundInvoiceSchema.index({  irn: 1 }, { unique: true });
OutboundInvoiceSchema.index({ createdAt: -1 });
OutboundInvoiceSchema.index({ invoiceNumber: 1 });

/**
 * Outbound Invoice Model
 */
export const OutboundInvoiceModel =
  mongoose.models.OutboundInvoice ||
  mongoose.model<OutboundInvoiceDocument>('OutboundInvoice', OutboundInvoiceSchema);
