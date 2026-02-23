import mongoose, { Schema, Document } from 'mongoose';

/**
 * Supported Schema Types/Sources
 */
export enum SchemaSourceType {
  // ERP Systems
  SAP = 'SAP',
  ORACLE = 'ORACLE',
  ZOHO = 'ZOHO',
  QUICKBOOKS = 'QUICKBOOKS',
  XERO = 'XERO',
  SAGE = 'SAGE',
  DYNAMICS = 'DYNAMICS',
  NETSUITE = 'NETSUITE',
  ODOO = 'ODOO',
  FRESHBOOKS = 'FRESHBOOKS',
  WAVE = 'WAVE',
  // Standards
  FIRS_UBL = 'FIRS_UBL',
  PEPPOL_BIS = 'PEPPOL_BIS',
  UBL_2_1 = 'UBL_2_1',
  // Custom
  CUSTOM = 'CUSTOM',
}

/**
 * Schema Status
 */
export enum SchemaStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
  ARCHIVED = 'archived',
}

/**
 * Field Data Types
 */
export enum FieldDataType {
  STRING = 'String',
  NUMBER = 'Number',
  BOOLEAN = 'Boolean',
  DATE = 'Date',
  DATETIME = 'DateTime',
  ARRAY = 'Array',
  OBJECT = 'Object',
  ENUM = 'Enum',
}

/**
 * Schema Field Definition Interface
 */
export interface ISchemaField {
  field_id: string;
  field_path: string;
  data_type: FieldDataType | string;
  format?: string;
  validation_rules?: string;
  description?: string;
  example_value?: any;
  is_required?: boolean;
  is_array?: boolean;
  parent_field_id?: string;
  enum_values?: string[];
  default_value?: any;
  min_length?: number;
  max_length?: number;
  min_value?: number;
  max_value?: number;
  mapping_hints?: string[];
}

/**
 * Schema Mapping Rule Interface
 * Used to define how fields map between different schemas
 */

/**
 * MongoDB Document interface for Invoice Schema Dictionary
 */
export interface InvoiceSchemaDictionaryDocument extends Document {
  // Schema Identification
  schema_id: string;
  name: string;
  description?: string; 

  // Source Information
  source_type: SchemaSourceType | string; 

  // Status & Metadata
  status: SchemaStatus; 
  tenant_id?: string;

  // Field Definitions
  fields: ISchemaField[];

  // Mapping Rules (for mapping to/from this schema)
  mapping_rules?: Array<Record<string, any>>

  // Additional Metadata
  metadata?: Record<string, any>; 

  // Audit
  created_by: string; 
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Schema Field Subdocument Schema
 */
const SchemaFieldSchema = new Schema<ISchemaField>(
  {
    field_id: {
      type: String,
      required: true,
    },
    field_path: {
      type: String,
      required: true,
    },
    data_type: {
      type: String,
      required: true,
      enum: [...Object.values(FieldDataType), 'String', 'Number', 'Boolean', 'Date', 'DateTime', 'Array', 'Object', 'Enum'],
    },
    format: {
      type: String,
    },
    validation_rules: {
      type: String,
    },
    description: {
      type: String,
    },
    example_value: {
      type: Schema.Types.Mixed,
    },
    is_required: {
      type: Boolean,
      default: false,
    },
    is_array: {
      type: Boolean,
      default: false,
    },
    parent_field_id: {
      type: String,
    },
    enum_values: [{
      type: String,
    }],
    default_value: {
      type: Schema.Types.Mixed,
    },
    min_length: {
      type: Number,
    },
    max_length: {
      type: Number,
    },
    min_value: {
      type: Number,
    },
    max_value: {
      type: Number,
    },
    mapping_hints: [{
      type: String,
    }],
  },
  { _id: false }
);

/**
 * Mongoose Schema for Invoice Schema Dictionary
 */
const InvoiceSchemaDictionarySchema = new Schema<InvoiceSchemaDictionaryDocument>(
  {
    schema_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    
    // Source Information
    source_type: {
      type: String,
      required: true, 
      index: true,
    },
    

    // Status & Metadata
    status: {
      type: String,
      enum: Object.values(SchemaStatus),
      default: SchemaStatus.DRAFT,
      index: true,
    },  
    tenant_id: {
      type: String,
      index: true,
    },

    // Field Definitions
    fields: {
      type: [SchemaFieldSchema],
      required: true,
    },

    // Mapping Rules
    mapping_rules: {
      type: Array<any>,
    },

    // Additional Metadata
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    

    // Audit
    created_by: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'invoice_schema_dictionaries',
  }
);

// Compound Indexes for performance
InvoiceSchemaDictionarySchema.index({ source_type: 1, status: 1 });
InvoiceSchemaDictionarySchema.index({ source_type: 1, is_default: 1 });
InvoiceSchemaDictionarySchema.index({ tenant_id: 1, source_type: 1 });
InvoiceSchemaDictionarySchema.index({ name: 'text', description: 'text' });

/**
 * Invoice Schema Dictionary Model
 */
export const InvoiceSchemaDictionaryModel =
  mongoose.models.InvoiceSchemaDictionary ||
  mongoose.model<InvoiceSchemaDictionaryDocument>('InvoiceSchemaDictionary', InvoiceSchemaDictionarySchema);
