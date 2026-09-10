import { Elysia } from "elysia";
import jsonSpread from "json-spread";
import { logger } from "../../../@lib";
import { LLMService } from "../../../@lib/adapters/llm/llm.service";
import { requireAdmin } from "../../../middlewares/auth";
import { onlyAdmin } from "../../auth/utils/access-checks";
import { TenantService } from "../../tenants/services/tenant.service";
import { TransformWorkflowService } from "../../workflow/services";
import { SystemConfigService } from "../services/system-config.service";
import { AuditService } from "../../audit/services/audit.service";
import { AuditEventType, AuditEventSeverity } from "../../audit/models";
import {
  SchemaStatus,
  ISchemaField,
  SchemaSourceType,
} from "../../workflow/models";
import type {
  MappingTemplate,
  FieldMappingRule,
  ArrayMappingRule,
} from "../../workflow/utils/transformer/mapping-spec.types";
import {
  addERPDictionaryValidation,
  getERPDictionaryValidation,
  listSupportedERPsValidation,
} from "../validations/erp-config.validation";

function extractFieldsFromSample(
  flatSample: Record<string, unknown>,
): Array<ISchemaField> {
  const fields: Array<ISchemaField> = [];
  for (const [key, value] of Object.entries(flatSample)) {
    if (!key) continue;
    let dataType = "String";
    if (typeof value === "number") {
      dataType = "Number";
    } else if (typeof value === "boolean") {
      dataType = "Boolean";
    } else if (Array.isArray(value)) {
      dataType = "Array";
    } else if (value && typeof value === "object") {
      dataType = "Object";
    }
    fields.push({
      field_id: key.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase(),
      field_path: key,
      data_type: dataType,
      is_required: false,
      is_array: Array.isArray(value),
      example_value: value !== undefined ? String(value) : undefined,
    });
  }
  return fields;
}

/**
 * ERP Configuration Routes
 */
export const erpConfigRoutes = new Elysia({ prefix: "/config/supported-erps" })
  .use(requireAdmin)
  .decorate("configService", new SystemConfigService())
  .decorate("tenantService", new TenantService())
  .decorate("transformWorkflowService", new TransformWorkflowService())
  .decorate("llmService", new LLMService())
  .decorate("auditService", new AuditService())
  /**
   * GET /admin/config/supported-erps
   * List all supported ERP systems
   */
  .get(
    "/",
    async ({ transformWorkflowService, set }) => {
      try {
        const erps = await transformWorkflowService.getSupportedERPTypes();

        return {
          success: true,
          data: erps,
          count: erps.length,
        };
      } catch (error: unknown) {
        const err = error as { statusCode?: number; message?: string };
        set.status = err.statusCode || 500;
        logger.error("Failed to fetch supported ERPs", {
          error: err.message,
        });
        return {
          success: false,
          error: err.message || "Failed to fetch supported ERPs",
          statusCode: err.statusCode || 500,
        };
      }
    },
    listSupportedERPsValidation,
  )

  /**
   * GET /admin/config/supported-erps/:erpType
   * Get a specific ERP configuration
   */
  .get(
    "/:erpType",
    async ({ params, transformWorkflowService, set }) => {
      try {
        const erp = await transformWorkflowService.getInvoiceSchema(
          params.erpType,
        );

        if (!erp) {
          set.status = 404;
          return {
            success: false,
            error: `ERP type '${params.erpType}' not found`,
            statusCode: 404,
          };
        }

        let erpDoc = erp;
        if (erp && "toObject" in erp && typeof erp.toObject === "function") {
          erpDoc = erp.toObject();
        }

        if (erpDoc) {
          let rules = erpDoc.mapping_rules;
          if (
            !rules &&
            erpDoc.metadata &&
            Array.isArray(erpDoc.metadata.mapping_rules)
          ) {
            rules = erpDoc.metadata.mapping_rules;
          }
          if (!rules) {
            rules = [];
          }
          erpDoc.mapping_rules = rules;
          const currentMeta: Record<string, unknown> = erpDoc.metadata
            ? { ...erpDoc.metadata }
            : {};
          currentMeta.mapping_rules = rules;
          erpDoc.metadata = currentMeta;
        }

        return {
          success: true,
          data: erpDoc,
        };
      } catch (error: unknown) {
        const err = error as { statusCode?: number; message?: string };
        set.status = err.statusCode || 500;
        logger.error("Failed to fetch ERP configuration", {
          error: err.message,
        });
        return {
          success: false,
          error: err.message || "Failed to fetch ERP configuration",
          statusCode: err.statusCode || 500,
        };
      }
    },
    getERPDictionaryValidation,
  )

  /**
   * POST /admin/config/supported-erps
   * Add a new ERP configuration
   */
  .post(
    "/",
    async ({
      auth,
      body,
      llmService,
      transformWorkflowService,
      auditService,
      set,
    }) => {
      try {
        onlyAdmin(auth!);
        const payload = body as {
          erp: string;
          invoice: Record<string, unknown>;
          mapping_type?: "manual" | "llm";
          mapping_template?: MappingTemplate;
          mapping_rules?: FieldMappingRule[];
          metadata?: Record<string, unknown> &
            Partial<MappingTemplate> & {
              template?: MappingTemplate;
              field_mappings?: FieldMappingRule[];
              array_mappings?: ArrayMappingRule[];
            };
        };

        const {
          erp,
          invoice,
          metadata,
          mapping_type = "llm",
          mapping_template,
          mapping_rules,
        } = payload;

        if (auth && auth.tenantId) {
          invoice.business_id = auth.businessId;
        }

        let effectiveTemplate: MappingTemplate;

        const candidateTemplate: Partial<MappingTemplate> | undefined =
          mapping_template ||
          (metadata && Array.isArray(metadata.field_mappings)
            ? (metadata as MappingTemplate)
            : undefined) ||
          (metadata && metadata.template ? metadata.template : undefined) ||
          (metadata && Array.isArray(metadata.array_mappings)
            ? (metadata as MappingTemplate)
            : undefined);

        if (mapping_type === "llm") {
          // Option A: LLM-Assisted Generation
          const schemaDoc =
            await transformWorkflowService.getInvoiceSchema("FIRS_UBL");
          const targetNrsData = schemaDoc?.fields || undefined;

          effectiveTemplate = await llmService.generateMappingTemplate(
            erp,
            invoice,
            "v1.0",
            targetNrsData,
          );
        } else {
          // Option B: Manual Mapping
          if (
            candidateTemplate &&
            (Array.isArray(candidateTemplate.field_mappings) ||
              Array.isArray(candidateTemplate.array_mappings))
          ) {
            effectiveTemplate = {
              erp_source: candidateTemplate.erp_source || erp,
              nrs_schema_version:
                candidateTemplate.nrs_schema_version || "v1.0",
              field_mappings: candidateTemplate.field_mappings || [],
              array_mappings: candidateTemplate.array_mappings || [],
              constants: candidateTemplate.constants || {},
            };
          } else if (Array.isArray(mapping_rules) && mapping_rules.length > 0) {
            const fieldMappings: FieldMappingRule[] = [];
            const arrayMappingsMap = new Map<string, ArrayMappingRule>();

            for (const r of mapping_rules) {
              if (
                r.source &&
                r.source.includes("[*]") &&
                r.target &&
                r.target.includes("[*]")
              ) {
                const [srcArr, ...srcRest] = r.source.split("[*].");
                const [tgtArr, ...tgtRest] = r.target.split("[*].");
                const key = `${srcArr}->${tgtArr}`;
                if (!arrayMappingsMap.has(key)) {
                  arrayMappingsMap.set(key, {
                    source_array: srcArr,
                    target_array: tgtArr,
                    item_mappings: [],
                  });
                }
                arrayMappingsMap.get(key)!.item_mappings.push({
                  source: srcRest.join("[*]."),
                  target: tgtRest.join("[*]."),
                  transform: r.transform,
                  default_value: r.default_value,
                  fallback_sources: r.fallback_sources,
                });
              } else {
                fieldMappings.push(r);
              }
            }

            effectiveTemplate = {
              erp_source: erp,
              nrs_schema_version: "v1.0",
              field_mappings: fieldMappings,
              array_mappings: Array.from(arrayMappingsMap.values()),
            };
          } else {
            // Fallback: extract fields from sample if no template provided
            const flatInvoice = jsonSpread(invoice)[0] as Record<
              string,
              unknown
            >;
            const extracted = extractFieldsFromSample(flatInvoice);
            effectiveTemplate = {
              erp_source: erp,
              nrs_schema_version: "v1.0",
              field_mappings: extracted.map((f) => ({
                source: f.field_path,
                target: f.field_path,
              })),
            };
          }
        }

        // Strict Gatekeeper: Validate sample invoice against NRS schema before saving
        const savedSchema = await transformWorkflowService.saveMappingTemplate(
          erp,
          effectiveTemplate,
          invoice,
          {
            tenantId: auth?.tenantId,
            createdBy: auth?.userId || "system",
          },
          auth,
        );

        // Audit log
        await auditService.createAuditLog({
          tenantId: auth?.tenantId,
          eventType: AuditEventType.SYSTEM_WARNING,
          severity: AuditEventSeverity.INFO,
          actorType: "user",
          actorId: auth?.userId || "admin",
          actorName: auth?.email || "Admin",
          resourceType: "erp_config",
          resourceId: erp,
          resourceName: erp,
          description: `ERP dictionary configured for ${erp}`,
          metadata: {
            erp,
            schema_id: savedSchema.schema_id,
            payload: body as Record<string, unknown>,
          },
        });

        const finalFields = savedSchema.fields || [];
        const finalMappingRules =
          savedSchema.mapping_rules ||
          savedSchema.metadata?.mapping_rules ||
          [];

        return {
          success: true,
          data: {
            schema_id: savedSchema.schema_id,
            erp_type: erp,
            fields_count: finalFields.length,
            fields: finalFields,
            status: savedSchema.status,
            mapping_rules: finalMappingRules,
            metadata: {
              ...(savedSchema.metadata || {}),
              mapping_rules: finalMappingRules,
            },
          },
        };
      } catch (error: unknown) {
        const err = error as { statusCode?: number; message?: string };
        set.status = err.statusCode || 500;
        return {
          success: false,
          error: err.message || "Failed to configure ERP dictionary",
          statusCode: err.statusCode || 500,
        };
      }
    },
    addERPDictionaryValidation,
  );
