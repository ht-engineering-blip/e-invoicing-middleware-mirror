import { aiConfig } from "../../../../@config";
import { AppError, logger } from "../../../../@lib";
import { LLMService } from "../../../../@lib/adapters/llm/llm.service";
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
  DeterministicMappingEngine,
  NRSSchemaRegistry,
  type MappingTemplate,
  type DeterministicTransformResult,
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

  constructor(_?: {
    tenantService?: TenantService;
    invoiceRepo?: InvoiceSchemaDictionaryRepository;
  }) {
    this.tenantService = _?.tenantService ?? new TenantService();
    this.invoiceRepo =
      _?.invoiceRepo ?? new InvoiceSchemaDictionaryRepository();
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
   * Resolve an active MappingTemplate for a given source ERP type
   */
  private async resolveMappingTemplate(
    sourceType?: SchemaSourceType | string,
  ): Promise<MappingTemplate | null> {
    if (!sourceType) return null;
    const schemaDoc = await this.getInvoiceSchema(sourceType);
    if (!schemaDoc) return null;

    if (schemaDoc.metadata && schemaDoc.metadata.mapping_template) {
      return schemaDoc.metadata.mapping_template as MappingTemplate;
    }

    if (
      Array.isArray(schemaDoc.mapping_rules) &&
      schemaDoc.mapping_rules.length > 0
    ) {
      const fieldMappings: any[] = [];
      const arrayMappings: any[] = [];

      for (const rule of schemaDoc.mapping_rules as any[]) {
        if (rule && rule.source && rule.target) {
          if (rule.source.includes("[*]") || rule.target.includes("[*]")) {
            const srcArr = rule.source.split("[*]")[0].replace(/\.$/, "");
            const tgtArr = rule.target.split("[*]")[0].replace(/\.$/, "");
            const srcItem = rule.source.split("[*].")[1] || "";
            const tgtItem = rule.target.split("[*].")[1] || "";

            let existingArr = arrayMappings.find(
              (a) => a.source_array === srcArr,
            );
            if (!existingArr) {
              existingArr = {
                source_array: srcArr,
                target_array: tgtArr,
                item_mappings: [],
              };
              arrayMappings.push(existingArr);
            }
            existingArr.item_mappings.push({
              source: srcItem,
              target: tgtItem,
            });
          } else {
            fieldMappings.push({
              source: rule.source,
              target: rule.target,
              fallback_sources: rule.fallback_sources,
              default_value: rule.default_value,
              transform: rule.transform,
            });
          }
        }
      }

      return {
        erp_source: String(sourceType),
        nrs_schema_version: "v1.0",
        field_mappings: fieldMappings,
        array_mappings: arrayMappings,
      };
    }

    return null;
  }

  /**
   * Transform invoice from source ERP format to FIRS UBL format
   */
  transformInvoice = async (
    invoice: TransformInvoiceInput,
    authContext?: AuthContext,
    sourceType?: SchemaSourceType | string,
  ): Promise<FIRSInvoice & Record<string, unknown>> => {
    // 1. Try fast deterministic transformation first
    try {
      const template = await this.resolveMappingTemplate(sourceType);
      if (
        template &&
        (template.field_mappings.length > 0 ||
          (template.array_mappings && template.array_mappings.length > 0))
      ) {
        const deterministicRes = DeterministicMappingEngine.transform(
          invoice as Record<string, any>,
          template,
          authContext,
        );

        if (deterministicRes.success && deterministicRes.data) {
          logger.info(
            `[TransformService] Fast deterministic V1 transformation completed in ${deterministicRes.executionTimeMs}ms`,
            { sourceType },
          );
          return deterministicRes.data as FIRSInvoice & Record<string, unknown>;
        }
      }
    } catch (detErr: any) {
      logger.warn(
        `[TransformService] Deterministic V1 pre-check failed, falling back to LLM`,
        { error: detErr?.message },
      );
    }

    // 2. Fallback to LLM Transformer
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
    // 1. Try fast deterministic transformation first
    try {
      const template = await this.resolveMappingTemplate(sourceType);
      if (
        template &&
        (template.field_mappings.length > 0 ||
          (template.array_mappings && template.array_mappings.length > 0))
      ) {
        const deterministicRes = DeterministicMappingEngine.transform(
          invoice as Record<string, any>,
          template,
          authContext,
        );

        if (deterministicRes.success && deterministicRes.data) {
          logger.info(
            `[TransformService] Fast deterministic V2 transformation completed in ${deterministicRes.executionTimeMs}ms`,
            { sourceType },
          );
          return deterministicRes.data as FIRSInvoice & Record<string, unknown>;
        }
      }
    } catch (detErr: any) {
      logger.warn(
        `[TransformService] Deterministic V2 pre-check failed, falling back to LLM`,
        { error: detErr?.message },
      );
    }

    // 2. Fallback to LLM Transformer V2
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
   * Test a MappingTemplate on a sample ERP invoice payload without saving
   */
  testMappingTemplate = async (
    samplePayload: Record<string, any>,
    template: MappingTemplate,
    authContext?: AuthContext,
  ): Promise<DeterministicTransformResult> => {
    // Load active NRS schema directly from DB dictionary
    const firsDoc = await this.getInvoiceSchema(SchemaSourceType.FIRS_UBL);
    if (firsDoc) {
      NRSSchemaRegistry.registerFromDB(
        template.nrs_schema_version || firsDoc?.version || "v1.0",
        firsDoc.name,
        firsDoc.description || "",
        firsDoc.fields,
        true,
      );
    }

    return DeterministicMappingEngine.transform(
      samplePayload,
      template,
      authContext,
    );
  };

  /**
   * Save a verified MappingTemplate for an ERP source.
   * STRICT GATEKEEPER: Validates the sample payload against the mapping template + NRS schema.
   * If validation fails, throws AppError and prevents saving to database.
   */
  saveMappingTemplate = async (
    erpType: string,
    template: MappingTemplate,
    sampleInvoice?: Record<string, any>,
    options?: {
      tenantId?: string;
      createdBy?: string;
    },
    authContext?: AuthContext,
  ): Promise<InvoiceSchemaDictionaryDocument> => {
    // 1. Gatekeeper: Validate sample invoice if provided
    if (sampleInvoice && Object.keys(sampleInvoice).length > 0) {
      const testResult = await this.testMappingTemplate(
        sampleInvoice,
        template,
        authContext,
      );

      if (!testResult.success) {
        const errorDetails = (testResult.errors || []).map((err) => ({
          message: err,
        }));
        throw new AppError(
          400,
          `Cannot save ERP mapping: Sample payload failed NRS schema validation (${(testResult.errors || []).length} errors found)`,
          "ERP_MAPPING_VALIDATION_FAILED",
          errorDetails,
        );
      }
    }

    const fields: ISchemaField[] = [];

    // Extract schema fields from mapping rules for dictionary persistence
    if (Array.isArray(template.field_mappings)) {
      for (const rule of template.field_mappings) {
        if (rule.source) {
          fields.push({
            field_id: rule.source.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase(),
            field_path: rule.source,
            data_type: "String",
            is_required: rule.is_required || false,
            description: rule.description || `Mapped to ${rule.target}`,
          });
        }
      }
    }

    const legacyRules: Array<Record<string, any>> = [];
    if (Array.isArray(template.field_mappings)) {
      for (const rule of template.field_mappings) {
        legacyRules.push({
          source: rule.source,
          target: rule.target,
          fallback_sources: rule.fallback_sources,
          default_value: rule.default_value,
          transform: rule.transform,
        });
      }
    }
    if (Array.isArray(template.array_mappings)) {
      for (const arr of template.array_mappings) {
        for (const item of arr.item_mappings) {
          legacyRules.push({
            source: `${arr.source_array}[*].${item.source}`,
            target: `${arr.target_array}[*].${item.target}`,
            transform: item.transform,
          });
        }
      }
    }

    return this.upsertERPSchema(erpType, fields, {
      tenantId: options?.tenantId,
      createdBy: options?.createdBy || "system",
      status: SchemaStatus.ACTIVE,
      mapping_rules: legacyRules,
      metadata: {
        mapping_template: template,
        sample_invoice: sampleInvoice,
        validated_at: new Date().toISOString(),
      },
    });
  };

  /**
   * Get supported NRS target schema versions loaded directly from DB
   */
  getNRSSchemas = async () => {
    const firsSchemas = await this.invoiceRepo.findBySourceType(
      SchemaSourceType.FIRS_UBL,
      true,
    );

    if (Array.isArray(firsSchemas) && firsSchemas.length > 0) {
      for (const doc of firsSchemas) {
        NRSSchemaRegistry.registerFromDB(
          doc?.version || "v1.0",
          doc.name,
          doc.description || "",
          doc.fields,
          doc.is_default || true,
        );
      }
    }

    return NRSSchemaRegistry.listSchemas();
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
        mapping_rules: schemaPayload.mapping_rules || [],
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
    const mappingRules =
      options?.mapping_rules || options?.metadata?.mapping_rules || [];

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
        mapping_rules: mappingRules,
      },
      mapping_rules: mappingRules,
    });
  };

  /**
   * Learn mapping rules using LLM once and persist to schema dictionary and cache
   */
  learnAndPersistMappingRules = async (
    sourceType: SchemaSourceType | string,
    sampleInvoice: Record<string, unknown>,
    options?: {
      tenantId?: string;
      createdBy?: string;
      firsSchema?: ISchemaField[];
    },
  ): Promise<Array<Record<string, any>>> => {
    if (!aiConfig?.enabled) {
      logger.info(
        "[TransformService] AI disabled, skipping LLM mapping rule learning",
      );
      return [];
    }

    try {
      const llmService = new LLMService();
      let firsFields = options?.firsSchema;
      if (!firsFields || firsFields.length === 0) {
        const firsDoc = await this.getInvoiceSchema(SchemaSourceType.FIRS_UBL);
        if (firsDoc) firsFields = firsDoc.fields;
      }

      logger.info(
        `[TransformService] Synthesizing one-time mapping rules for ${sourceType} via LLM...`,
      );
      const rules = await llmService.generateMappingRules(
        String(sourceType),
        sampleInvoice,
        firsFields,
      );

      if (rules && rules.length > 0) {
        const existingSchema = await this.getInvoiceSchema(sourceType);
        const fields = existingSchema?.fields || [];

        await this.upsertERPSchema(String(sourceType), fields, {
          tenantId: options?.tenantId,
          createdBy: options?.createdBy || "system",
          mapping_rules: rules,
          status: SchemaStatus.ACTIVE,
          metadata: {
            source_invoice_sample: sampleInvoice,
            learned_at: new Date().toISOString(),
          },
        });

        logger.info(
          `[TransformService] Successfully learned and persisted ${rules.length} mapping rules for ${sourceType}. Subsequent transforms will run 100% deterministically with 0 LLM calls.`,
        );
        return rules;
      }
    } catch (err: any) {
      logger.warn(
        `[TransformService] Failed to synthesize mapping rules via LLM for ${sourceType}:`,
        {
          error: err.message,
        },
      );
    }
    return [];
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
    const saved = await this.upsertInvoiceSchema(SchemaSourceType.FIRS_UBL, {
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

    // Dynamically register into runtime NRSSchemaRegistry
    NRSSchemaRegistry.registerFromDB(
      "v1.0",
      saved.name,
      saved.description || "",
      saved.fields,
      true,
    );

    return saved;
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
