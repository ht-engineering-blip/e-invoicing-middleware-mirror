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
import { SchemaStatus, ISchemaField } from "../../workflow/models";
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
          if (!rules && erpDoc.metadata && Array.isArray(erpDoc.metadata.mapping_rules)) {
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
          metadata?: Record<string, unknown> & {
            status?: SchemaStatus;
            mapping_rules?: Array<Record<string, unknown>>;
            source_invoice_sample?: Record<string, unknown>;
          };
          mapping_rules?: Array<Record<string, unknown>>;
          fields?: Array<ISchemaField>;
          regenerate_fields?: boolean;
        };

        const { erp, invoice, metadata } = payload;
        if (auth && auth.tenantId) {
          invoice.business_id = auth.businessId;
        }

        // Flatten the invoice for field extraction
        const flatInvoice = jsonSpread(invoice)[0] as Record<string, unknown>;
        let flatMetadata: Record<string, unknown> | undefined = undefined;
        if (metadata) {
          flatMetadata = jsonSpread(metadata)[0] as Record<string, unknown>;
        }
        const mapping_rules =
          metadata?.mapping_rules || payload.mapping_rules || [];

        // Check if schema already exists to avoid slow redundant LLM calls on update
        const existingSchema = await transformWorkflowService.getInvoiceSchema(erp);

        let generatedFields: Array<ISchemaField> = [];
        if (payload.fields && Array.isArray(payload.fields) && payload.fields.length > 0) {
          generatedFields = payload.fields;
        } else if (
          existingSchema &&
          Array.isArray(existingSchema.fields) &&
          existingSchema.fields.length > 0 &&
          !payload.regenerate_fields
        ) {
          // Fast path: preserve existing schema fields on updates
          generatedFields = existingSchema.fields;
        } else if (flatInvoice && Object.keys(flatInvoice).length > 0) {
          try {
            generatedFields = await Promise.race([
              llmService.generateInvoiceDictionary(erp, flatInvoice, flatMetadata),
              new Promise<Array<ISchemaField>>((_, reject) =>
                setTimeout(() => reject(new Error("LLM generation timeout")), 5000),
              ),
            ]);
          } catch (llmErr: unknown) {
            const err = llmErr as { message?: string };
            logger.warn("LLM dictionary generation timed out/failed, falling back to direct field extraction", {
              erp,
              error: err.message,
            });
            generatedFields = extractFieldsFromSample(flatInvoice);
          }
        } else {
          generatedFields = [];
        }

        // Upsert the schema to database
        const savedSchema = await transformWorkflowService.upsertERPSchema(
          erp,
          generatedFields,
          {
            tenantId: auth?.tenantId,
            createdBy: auth?.userId || "system",
            status: metadata?.status,
            metadata: {
              ...(metadata || {}),
              mapping_rules,
              source_invoice_sample:
                metadata?.source_invoice_sample || flatInvoice,
              generated_at: new Date().toISOString(),
            },
            mapping_rules,
          },
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

        const effectiveMappingRules =
          savedSchema.mapping_rules ||
          savedSchema.metadata?.mapping_rules ||
          mapping_rules;

        return {
          success: true,
          data: {
            schema_id: savedSchema.schema_id,
            erp_type: erp,
            fields_count: generatedFields.length,
            fields: generatedFields,
            status: savedSchema.status,
            mapping_rules: effectiveMappingRules,
            metadata: {
              ...(savedSchema.metadata || {}),
              mapping_rules: effectiveMappingRules,
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
