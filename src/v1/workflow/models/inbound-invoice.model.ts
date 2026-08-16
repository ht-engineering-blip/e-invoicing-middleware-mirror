import mongoose, { Schema, Document } from 'mongoose'; 
import { WebhookEventDocument } from '../../webhook/models';

/**
 * Inbound Invoice Status
 */
export enum InboundInvoiceStatus {
  TRANSMITTED = 'TRANSMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  DOWNLOADED = 'DOWNLOADED',
  SYNCED_TO_ERP = 'SYNCED_TO_ERP',
  PAID = 'PAID',
  REJECTED = 'REJECTED',
  CANCELED = 'CANCELED',
}

/**
 * Payment Status
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  PARTIAL = 'PARTIAL',
  OVERDUE = 'OVERDUE',
}

/**
 * Inbound Workflow State Interface
 */
export interface IInboundWorkflowState {
  notified: boolean;
  acknowledged: boolean;
  downloaded: boolean;
  synced: boolean;
  paymentUpdated: boolean;
}

/**
 * Payment Details Interface
 */
export interface IPaymentDetails {
  paymentDate?: Date;
  paymentMethod?: string;
  transactionReference?: string;
  amountPaid?: number;
}

 

/**
 * MongoDB Document interface for Inbound Invoice
 */
export interface InboundInvoiceDocument extends Document {
  tenantId: string;
  businessId: string;
  irn: string;

  // Invoice Data
  invoice: any;
  decryptedData: any;

  // Supplier Information
  supplierTIN: string;
  supplierName: string;
  supplierAddress?: string;

  // Invoice Details
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  totalAmount: number;
  currency: string;

  // Status & Workflow
  status: InboundInvoiceStatus;
  workflowState: IInboundWorkflowState;

  // Payment Information
  paymentStatus?: PaymentStatus;
  paymentDetails?: IPaymentDetails;

  // Rejection Information
  rejectionReason?: string;
  rejectedAt?: Date;
  rejectedBy?: string;

  // Acknowledgement Information
  acknowledgedAt?: Date;

  // Audit Trail
  createdAt: Date;
  updatedAt: Date;
  webhookEvents: WebhookEventDocument[];

  // Metadata
  metadata: Record<string, any>;
}

/**
 * Mongoose Schema for Inbound Invoice collection
 */
const InboundInvoiceSchema = new Schema<InboundInvoiceDocument>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    businessId: {
      type: String,
      required: true,
      index: true,
    },
    irn: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Invoice Data
    invoice: {
      type: Schema.Types.Mixed,
      required: true,
    },
    decryptedData: {
      type: Schema.Types.Mixed,
    },

    // Supplier Information
    supplierTIN: {
      type: String,
      required: true,
    },
    supplierName: {
      type: String,
      required: true,
    },
    supplierAddress: {
      type: String,
    },

    // Invoice Details
    invoiceNumber: {
      type: String,
      required: true,
      index: true,
    },
    issueDate: {
      type: Date,
      required: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      default: 'NGN',
    },

    // Status & Workflow
    status: {
      type: String,
      enum: Object.values(InboundInvoiceStatus),
      default: InboundInvoiceStatus.TRANSMITTED,
      index: true,
    },
    workflowState: {
      notified: { type: Boolean, default: false },
      acknowledged: { type: Boolean, default: false },
      downloaded: { type: Boolean, default: false },
      synced: { type: Boolean, default: false },
      paymentUpdated: { type: Boolean, default: false },
    },

    // Payment Information
    paymentStatus: {
      type: String,
      enum: Object.values(PaymentStatus),
    },
    paymentDetails: {
      paymentDate: { type: Date },
      paymentMethod: { type: String },
      transactionReference: { type: String },
      amountPaid: { type: Number },
    },

    // Rejection Information
    rejectionReason: { type: String },
    rejectedAt: { type: Date },
    rejectedBy: { type: String },

    // Audit Trail
    webhookEvents: [
      {
        eventType: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        payload: { type: Schema.Types.Mixed },
        response: { type: Schema.Types.Mixed },
        success: { type: Boolean, required: true },
      },
    ],

    // Metadata
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'inbound_invoices',
  }
);

// Compound Indexes for performance
InboundInvoiceSchema.index({ tenantId: 1, status: 1 });
InboundInvoiceSchema.index({ tenantId: 1, createdAt: -1 });
InboundInvoiceSchema.index({ businessId: 1, createdAt: -1 });
InboundInvoiceSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
InboundInvoiceSchema.index({ businessId: 1, irn: 1 }, { unique: true });
InboundInvoiceSchema.index({ createdAt: -1 });

/**
 * Inbound Invoice Model
 */
export const InboundInvoiceModel =
  mongoose.models.InboundInvoice ||
  mongoose.model<InboundInvoiceDocument>('InboundInvoice', InboundInvoiceSchema);
