import mongoose, { Schema, Document } from "mongoose";
import { SchemaSourceType } from "./invoice-schema-dictionary.model";
/**
 * Outbound Invoice Status
 */
export enum OutboundInvoiceStatus {
  CREATED = "CREATED",
  RETRYING = "RETRYING",
  VALIDATED = "VALIDATED",
  SIGNED = "SIGNED",
  TRANSMITTED = "TRANSMITTED",
  TRANSMISTION_FAILED = "TRANSMISTION_FAILED",
  DELIVERED = "DELIVERED",
  FAILED = "FAILED",
}

export enum OutboundPaymentStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  PARTIAL = "PARTIAL",
  OVERDUE = "OVERDUE",
}

export enum OutboundInvoiceSource {
  WEBHOOK = "webhook",
  API = "api",
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
  errorLog: string[];
  fixed: boolean;
}

/**
 * Last job failure recorded on the invoice for quick display
 */
export interface ILastJobError {
  action: string;
  error: string;
  failedAt: Date;
}

/**
 * Payment details for a paid outbound invoice
 */
export interface IOutboundPaymentDetails {
  paymentDate?: Date;
  paymentMethod?: string;
  transactionReference?: string;
  amountPaid?: number;
}

/**
 * MongoDB Document interface for Outbound Invoice
 */
export interface OutboundInvoiceDocument extends Document {
  tenantId: string;
  irn: string;
  erpInvoiceId?: string; // raw ID extracted from ERP payload
  source: OutboundInvoiceSource;

  // Status & Workflow
  status: OutboundInvoiceStatus;
  workflowState: IWorkflowState;
  lastJobError?: ILastJobError;

  // Payment
  paymentStatus: OutboundPaymentStatus;
  paymentDetails?: IOutboundPaymentDetails;

  // FIRS resp
  qrCode: String;

  // Validation
  validationAttempts: number;
  validationErrors?: IValidationError[];

  // Audit Trail
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  webhookEvents: string[]; // array of WebhookEvent.eventId references

  // Metadata
  erpSystem: SchemaSourceType | string;
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
      required: true,
    },
    erpInvoiceId: {
      type: String,
    },
    source: {
      type: String,
      enum: Object.values(OutboundInvoiceSource),
      default: OutboundInvoiceSource.API,
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
    lastJobError: {
      action: { type: String },
      error: { type: String },
      failedAt: { type: Date },
    },

    // Payment
    paymentStatus: {
      type: String,
      enum: Object.values(OutboundPaymentStatus),
      default: OutboundPaymentStatus.PENDING,
      index: true,
    },
    paymentDetails: {
      paymentDate: { type: Date },
      paymentMethod: { type: String },
      transactionReference: { type: String },
      amountPaid: { type: Number },
    },

    // Validation
    validationAttempts: {
      type: Number,
      default: 0,
    },
    validationErrors: [
      {
        attempt: { type: Number, required: true },
        errorLog: [{ type: String }],
        fixed: { type: Boolean, default: false },
      },
    ],

    // Audit Trail
    createdBy: {
      type: String,
      required: true,
    },
    // Array of WebhookEvent.eventId strings
    webhookEvents: [{ type: String }],

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
    collection: "outbound_invoices",
    suppressReservedKeysWarning: true,
  },
);

// Compound Indexes for performance
OutboundInvoiceSchema.index({ tenantId: 1, status: 1 });
OutboundInvoiceSchema.index({ tenantId: 1, irn: 1 });
OutboundInvoiceSchema.index({ tenantId: 1, createdAt: -1 });
OutboundInvoiceSchema.index({ businessId: 1, createdAt: -1 });
OutboundInvoiceSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
OutboundInvoiceSchema.index({ irn: 1 }, { unique: true });
OutboundInvoiceSchema.index({ invoiceNumber: 1 });
OutboundInvoiceSchema.index(
  { tenantId: 1, erpInvoiceId: 1 },
  {
    unique: true,
    partialFilterExpression: { erpInvoiceId: { $type: "string" } },
  },
);
OutboundInvoiceSchema.index({ createdAt: -1 });
OutboundInvoiceSchema.index({ source: 1 });

/**
 * Outbound Invoice Model
 */
export const OutboundInvoiceModel =
  mongoose.models.OutboundInvoice ||
  mongoose.model<OutboundInvoiceDocument>(
    "OutboundInvoice",
    OutboundInvoiceSchema,
  );
