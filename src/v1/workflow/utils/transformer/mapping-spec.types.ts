/**
 * Supported Field Transformation Operations
 */
export type TransformationOp =
  | "toString"
  | "toNumber"
  | "toBoolean"
  | "toDate" // e.g. "toDate" or "toDate(YYYY-MM-DD)"
  | "toTime" // e.g. "toTime" or "toTime(HH:MM:SS)"
  | "trim"
  | "uppercase"
  | "lowercase"
  | "sanitizePhone"
  | "sanitizeHsn"
  | "sanitizePriceUnit"
  | "mathMultiply"
  | "mathAdd"
  | "customFormula";

/**
 * Context interface for authenticated requests and tenant metadata
 */
export interface AuthContext {
  tenantId: string;
  businessId?: string;
  businessName?: string;
  businessTIN?: string;
  tenantERP?: string;
  serviceId?: string;
  isAdmin?: boolean;
}

/**
 * Schema Field Definition Interface
 */
export interface ISchemaField {
  field_id: string;
  field_path: string;
  data_type: string;
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
}

/**
 * Single Field Mapping Rule
 */
export interface FieldMappingRule {
  /** Target path in the destination NRS / FIRS schema (e.g. "accounting_customer_party.tin" or "issue_date") */
  target: string;

  /** Primary source path in the source ERP payload (e.g. "customer.tax_id" or "invoice_date") */
  source?: string;

  /** List of fallback source paths to inspect sequentially if primary source is empty or missing */
  fallback_sources?: string[];

  /** Static default value to assign if all source paths are missing/null */
  default_value?: unknown;

  /** Name of the transform operation or formatting string (e.g. "toDate(YYYY-MM-DD)", "toNumber", "trim") */
  transform?: TransformationOp | string;

  /** Whether the field is strictly mandatory in the output schema */
  is_required?: boolean;

  /** Optional description or mapping rationale */
  description?: string;
}

/**
 * Array Structure Mapping Rule (e.g. mapping line items or tax subtotals)
 */
export interface ArrayMappingRule {
  /** Path to the array in the source ERP payload (e.g. "items" or "line_items") */
  source_array: string;

  /** Path to the array in the destination NRS schema (e.g. "invoice_line" or "tax_total[0].tax_subtotal") */
  target_array: string;

  /** Individual field mapping rules for each object in the array */
  item_mappings: FieldMappingRule[];

  /** Whether the array is required to have at least one element */
  min_items?: number;
}

/**
 * Complete Mapping Template Specification
 */
export interface MappingTemplate {
  /** Identifier of the ERP source (e.g. "SAP", "SAGE", "ORACLE", "ZOHO", "CUSTOM") */
  erp_source: string;

  /** Optional tenant identifier for tenant-specific overrides */
  tenant_id?: string;

  /** Target NRS / FIRS schema version (e.g. "v1.0", "v2.0") */
  nrs_schema_version?: string;

  /** Description or friendly label */
  description?: string;

  /** Flat / top-level field mapping rules */
  field_mappings: FieldMappingRule[];

  /** Array mapping rules (line items, references, etc.) */
  array_mappings?: ArrayMappingRule[];

  /** Static metadata constants to inject into target payload */
  constants?: Record<string, unknown>;

  /** Version of the mapping template definition */
  version?: number;
}

/**
 * Result of a deterministic transformation run
 */
export interface DeterministicTransformResult {
  success: boolean;
  data?: Record<string, any>;
  errors?: string[];
  appliedRulesCount: number;
  healedFields: string[];
  missingRequiredFields?: string[];
  executionTimeMs: number;
}
