import { aiConfig } from "../../../../@config";
import { AppError, logger } from "../../../../@lib";
import { AuthContext } from "../../../../middlewares";
import { TTLCache } from "../../../shared/utils";
import { TenantService } from "../../../tenants/services/tenant.service";
import {
  InvoiceSchemaDictionaryDocument,
  ISchemaField,
  SchemaSourceType,
  SchemaStatus,
} from "../../models";
import {
  CreateSchemaDictionaryInput,
  InvoiceSchemaDictionaryRepository,
  UpdateSchemaDictionaryInput,
} from "../../repos/invoice-schema-dictionary.repo";
import {
  FIRSInvoiceTransformer,
  type FIRSInvoice,
  type TransformationResult,
  type TransformInvoiceInput,
} from "../../utils/transformer";
import { FIRSInvoiceTransformerV2 } from "../../utils/transformer/v2";

/**
 * Input for upserting invoice schema
 */
export interface UpsertSchemaInput {
  schema_id: string;
  name: string;
  description?: string;
  source_type: SchemaSourceType | string;
  fields: ISchemaField[];
  status?: SchemaStatus;
  tenant_id?: string;
  metadata?: Record<string, any>;
  mapping_rules?: Array<Record<string, any>>;
  created_by?: string;
}

export class TransformWorkflowService {
  private tenantService: TenantService;
  private invoiceRepo: InvoiceSchemaDictionaryRepository;

  // Cache schemas for 10 minutes to eliminate repetitive DB queries
  private schemaCache = new TTLCache<
    string,
    InvoiceSchemaDictionaryDocument | null
  >({
    maxItems: 200,
    defaultTtlMs: 600_000,
  });

  constructor(dep?: {
    tenantService?: TenantService;
    invoiceRepo?: InvoiceSchemaDictionaryRepository;
  }) {
    this.tenantService = dep?.tenantService ?? new TenantService();
    this.invoiceRepo =
      dep?.invoiceRepo ?? new InvoiceSchemaDictionaryRepository();
  }

  /**
   * Extracts and normalizes errors from a TransformationResult
   */
  private extractTransformationErrors(
    result: TransformationResult | null | undefined,
  ): string[] {
    if (!result) return ["Transformation result is empty"];

    if (Array.isArray(result.errors) && result.errors.length > 0) {
      const sanitizedErrors: string[] = [];
      for (const err of result.errors) {
        if (typeof err === "string" && err.trim() !== "") {
          sanitizedErrors.push(err.trim());
        } else if (err !== null && err !== undefined) {
          sanitizedErrors.push(JSON.stringify(err));
        }
      }

      if (sanitizedErrors.length > 0) return sanitizedErrors;
    }

    if (
      result.validationErrors &&
      Array.isArray(result.validationErrors.issues)
    ) {
      const zodErrors: string[] = [];
      for (const issue of result.validationErrors.issues) {
        const path = issue.path.join(".");
        if (path && path.trim() !== "") {
          zodErrors.push(`${path}: ${issue.message}`);
        } else {
          zodErrors.push(issue.message);
        }
      }

      if (zodErrors.length > 0) return zodErrors;
    }

    return ["Transformation failed"];
  }

  /**
   * Logs and throws a standardized AppError for transformation failures
   */
  private handleTransformationFailure(
    serviceLabel: string,
    result: TransformationResult | null | undefined,
  ): never {
    const errors = this.extractTransformationErrors(result);
    const primaryErrorMessage = errors[0] || "Transformation failed";

    logger.error(`[TransformService] ${serviceLabel} failed`, {
      primaryError: primaryErrorMessage,
      errorCount: errors.length,
      errors,
    });

    const errorDetails = errors.map((errMessage) => ({
      message: errMessage,
    }));

    throw new AppError(
      400,
      primaryErrorMessage,
      "TRANSFORMATION_ERROR",
      errorDetails,
    );
  }

  /**
   * Transform invoice from source ERP format to FIRS UBL format
   */
  transformInvoice = async (
    invoice: TransformInvoiceInput,
    authContext?: AuthContext,
    sourceType?: SchemaSourceType | string,
  ): Promise<FIRSInvoice & Record<string, unknown>> => {
    const transformer = new FIRSInvoiceTransformer(
      aiConfig?.apiKey!,
      aiConfig?.apiEndpoint!,
      aiConfig?.provider!,
      aiConfig?.model!,
    );

    const result = await transformer.transformAndValidate(
      invoice,
      authContext,
      sourceType,
    );

    if (result && result.success && result.data) {
      return result.data as FIRSInvoice & Record<string, unknown>;
    } else {
      this.handleTransformationFailure("V1 Transformation", result);
    }
  };

  /**
   * Transform invoice from source ERP format to FIRS UBL format (V2)
   */
  transformInvoiceV2 = async (
    invoice: TransformInvoiceInput,
    authContext?: AuthContext,
    sourceType?: SchemaSourceType | string,
  ): Promise<FIRSInvoice & Record<string, unknown>> => {
    const transformer = new FIRSInvoiceTransformerV2(
      aiConfig?.apiKey!,
      aiConfig?.apiEndpoint!,
      aiConfig?.provider,
      aiConfig?.model!,
    );

    const result = await transformer.transformAndValidate(
      invoice,
      authContext,
      sourceType,
    );

    if (result && result.success && result.data) {
      return result.data as FIRSInvoice & Record<string, unknown>;
    } else {
      this.handleTransformationFailure("V2 Transformation", result);
    }
  };

  /**
   * Upsert (create or update) an invoice schema dictionary
   */
  upsertInvoiceSchema = async (
    sourceType: SchemaSourceType | string,
    schemaPayload: Partial<UpsertSchemaInput>,
  ): Promise<InvoiceSchemaDictionaryDocument> => {
    const schemaId =
      schemaPayload.schema_id || this.generateSchemaId(sourceType);

    this.schemaCache.delete(`source:${sourceType}`);
    this.schemaCache.delete(`id:${schemaId}`);

    const existingSchema = await this.invoiceRepo.findBySchemaId(schemaId);

    if (existingSchema) {
      const updatePayload: UpdateSchemaDictionaryInput = {
        updated_by: schemaPayload.created_by || "system",
      };

      if (schemaPayload.name) updatePayload.name = schemaPayload.name;
      if (schemaPayload.description) {
        updatePayload.description = schemaPayload.description;
      }
      if (schemaPayload.fields) updatePayload.fields = schemaPayload.fields;
      if (schemaPayload.status) updatePayload.status = schemaPayload.status;
      if (schemaPayload.metadata) {
        updatePayload.metadata = schemaPayload.metadata;
      }
      if (schemaPayload.mapping_rules) {
        updatePayload.mapping_rules = schemaPayload.mapping_rules;
      }

      const updated = await this.invoiceRepo.update(schemaId, updatePayload);
      this.schemaCache.set(`id:${schemaId}`, updated);
      this.schemaCache.set(`source:${sourceType}`, updated);
      return updated;
    } else {
      const createPayload: CreateSchemaDictionaryInput = {
        schema_id: schemaId,
        name: schemaPayload.name || this.getDefaultSchemaName(sourceType),
        description:
          schemaPayload.description || `Invoice schema for ${sourceType}`,
        source_type: sourceType,
        fields: schemaPayload.fields || [],
        status: schemaPayload.status || SchemaStatus.DRAFT,
        tenant_id: schemaPayload.tenant_id,
        metadata: schemaPayload.metadata || {},
        created_by: schemaPayload.created_by || "system",
      };

      const created = await this.invoiceRepo.create(createPayload);
      this.schemaCache.set(`id:${schemaId}`, created);
      this.schemaCache.set(`source:${sourceType}`, created);
      return created;
    }
  };

  /**
   * Upsert ERP-specific invoice schema
   */
  upsertERPSchema = async (
    erpType: string,
    fields: ISchemaField[],
    options?: {
      tenantId?: string;
      status?: SchemaStatus;
      createdBy?: string;
      metadata?: Record<string, any>;
      mapping_rules?: Array<Record<string, any>>;
    },
  ): Promise<InvoiceSchemaDictionaryDocument> => {
    let normalizedErp = erpType.toUpperCase().replace(/[-\s]/g, "_");
    const key = normalizedErp as keyof typeof SchemaSourceType;
    const sourceType = SchemaSourceType[key] || normalizedErp;

    return this.upsertInvoiceSchema(sourceType, {
      schema_id: `${normalizedErp}_INVOICE_SCHEMA`,
      name: `${erpType} Invoice Schema`,
      description: `Invoice field mapping schema for ${erpType} ERP system`,
      source_type: sourceType,
      fields,
      status: options?.status || SchemaStatus.DRAFT,
      tenant_id: options?.tenantId,
      created_by: options?.createdBy || "system",
      metadata: {
        erp_type: erpType,
        ...options?.metadata,
      },
      mapping_rules: options?.mapping_rules || [],
    });
  };

  /**
   * Upsert FIRS UBL invoice schema
   */
  upsertFIRSSchema = async (
    fields: ISchemaField[],
    options?: {
      createdBy?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<InvoiceSchemaDictionaryDocument> => {
    return this.upsertInvoiceSchema(SchemaSourceType.FIRS_UBL, {
      schema_id: "FIRS_UBL_INVOICE_SCHEMA",
      name: "FIRS UBL Invoice Schema",
      description: "Nigerian FIRS Universal Business Language invoice schema",
      source_type: SchemaSourceType.FIRS_UBL,
      fields,
      status: SchemaStatus.ACTIVE,
      created_by: options?.createdBy || "system",
      metadata: {
        standard: "UBL 2.1",
        jurisdiction: "Nigeria",
        ...options?.metadata,
      },
    });
  };

  /**
   * Get invoice schema by source type with caching
   */
  getInvoiceSchema = async (
    sourceType: SchemaSourceType | string,
  ): Promise<InvoiceSchemaDictionaryDocument | null> => {
    const cacheKey = `source:${sourceType}`;
    const cached = this.schemaCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const s = await this.invoiceRepo.findDefaultBySourceType(sourceType);
    if (s) {
      this.schemaCache.set(cacheKey, s);
      return s;
    }

    const schemas = await this.invoiceRepo.findBySourceType(sourceType, true);
    const result = schemas.length > 0 ? schemas[0] : null;
    this.schemaCache.set(cacheKey, result);
    return result;
  };

  /**
   * Get invoice schema by schema ID with caching
   */
  getInvoiceSchemaById = async (
    schemaId: string,
  ): Promise<InvoiceSchemaDictionaryDocument | null> => {
    const cacheKey = `id:${schemaId}`;
    const cached = this.schemaCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const schema = await this.invoiceRepo.findBySchemaId(schemaId);
    this.schemaCache.set(cacheKey, schema);
    return schema;
  };

  /**
   * List all invoice schemas with optional filtering
   */
  listInvoiceSchemas = async (
    filters?: {
      sourceType?: SchemaSourceType | string;
      status?: SchemaStatus;
      tenantId?: string;
    },
    page: number = 1,
    limit: number = 20,
  ) => {
    return this.invoiceRepo.findMany(
      {
        source_type: filters?.sourceType,
        status: filters?.status,
        tenant_id: filters?.tenantId,
      },
      limit,
      page,
    );
  };

  /**
   * Activate a schema
   */
  activateSchema = async (
    schemaId: string,
    updatedBy: string = "system",
  ): Promise<InvoiceSchemaDictionaryDocument> => {
    this.schemaCache.clear();
    return this.invoiceRepo.setStatus(schemaId, SchemaStatus.ACTIVE, updatedBy);
  };

  /**
   * Set a schema as default for its source type
   */
  setSchemaAsDefault = async (
    schemaId: string,
    updatedBy: string = "system",
  ): Promise<InvoiceSchemaDictionaryDocument> => {
    this.schemaCache.clear();
    return this.invoiceRepo.setAsDefault(schemaId, updatedBy);
  };

  /**
   * Delete an invoice schema
   */
  deleteInvoiceSchema = async (schemaId: string): Promise<boolean> => {
    this.schemaCache.clear();
    return this.invoiceRepo.delete(schemaId);
  };

  /**
   * Get all supported ERP types with their schema status
   */
  getSupportedERPTypes = async () => {
    return this.invoiceRepo.getSourceTypesSummary();
  };

  /**
   * Generate a unique schema ID based on source type
   */
  private generateSchemaId(sourceType: SchemaSourceType | string): string {
    const normalized = sourceType
      .toString()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "_");
    return `${normalized}_INVOICE_SCHEMA`;
  }

  /**
   * Get default schema name based on source type
   */
  private getDefaultSchemaName(sourceType: SchemaSourceType | string): string {
    const typeStr = sourceType.toString();
    return (
      typeStr
        .split("_")
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ") + " Invoice Schema"
    );
  }
}
