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
import { SchemaStatus } from "../../workflow/models";
import {
  addERPDictionaryValidation,
  getERPDictionaryValidation,
  listSupportedERPsValidation,
} from "../validations/erp-config.validation";

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
    async ({ transformWorkflowService, set }): Promise<any> => {
      try {
        const erps = await transformWorkflowService.getSupportedERPTypes();

        return {
          success: true,
          data: erps,
          count: erps.length,
        };
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to fetch supported ERPs", {
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Failed to fetch supported ERPs",
          statusCode: error.statusCode || 500,
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
          const rules =
            erpDoc.mapping_rules || erpDoc.metadata?.mapping_rules || [];
          erpDoc.mapping_rules = rules;
          erpDoc.metadata = {
            ...(erpDoc.metadata || {}),
            mapping_rules: rules,
          };
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

        // Generate invoice dictionary using LLM
        const generatedFields = await llmService.generateInvoiceDictionary(
          erp,
          flatInvoice,
          flatMetadata,
        );

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
