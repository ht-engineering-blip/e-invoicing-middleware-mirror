import { Elysia } from "elysia";
import { requireAdmin } from "../../../middlewares/auth";
import { logger } from "../../../@lib";
import jsonSpread from "json-spread";
import { SystemConfigService } from "../services/system-config.service";
import { TenantService } from "../../tenants/services/tenant.service";
import { TransformWorkflowService } from "../../workflow/services";
import { LLMService } from "../../../@lib/adapters/llm/llm.service";
import { onlyAdmin } from "../../auth/utils/access-checks";
import { SchemaSourceType } from "../../workflow/models";
import { AuditService } from "../../audit/services/audit.service";
import { AuditEventType, AuditEventSeverity } from "../../audit/models";
import {
  getFIRSDictionaryValidation,
  updateFIRSDictionaryValidation,
} from "../validations/firs-config.validation";

/**
 * FIRS Dictionary Configuration Routes
 */
export const firsConfigRoutes = new Elysia({
  prefix: "/config/firs-dictionary",
})
  .use(requireAdmin)
  .decorate("configService", new SystemConfigService())
  .decorate("tenantService", new TenantService())
  .decorate("transformWorkflowService", new TransformWorkflowService())
  .decorate("llmService", new LLMService())
  .decorate("auditService", new AuditService())
  /**
   * GET /admin/config/firs-dictionary
   * Get current FIRS dictionary schema
   */
  .get(
    "/",
    async ({ configService, transformWorkflowService, set }) => {
      try {
        const firsSchemaDoc = await transformWorkflowService.getInvoiceSchema(
          SchemaSourceType.FIRS_UBL,
        );

        if (!firsSchemaDoc) {
          return {
            success: true,
            message: "FIRS dictionary not configured",
            data: {
              schema: null,
              version: 0,
            },
          };
        }

        return {
          success: true,
          data: firsSchemaDoc,
        };
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to fetch FIRS dictionary", {
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Failed to fetch FIRS dictionary",
          statusCode: error.statusCode || 500,
        };
      }
    },
    getFIRSDictionaryValidation,
  )

  /**
   * PUT /admin/config/firs-dictionary
   * Update FIRS dictionary schema
   */
  .put(
    "/",
    async ({ auth, body, query, llmService, transformWorkflowService, auditService, set }) => {
      try {
        onlyAdmin(auth!);
        let { invoice, metadata }: any = body;

        // Flatten the invoice and metadata for field extraction
        let flatInvoice = jsonSpread(invoice)[0];
        let invoiceKeyTypes: any = {};
        /*  Object.keys(invoice).forEach(key => {
           const value = invoice[key];
           invoiceKeyTypes[key] = typeof value
         }); */
        let flatMetadata = metadata ? jsonSpread(metadata)[0] : {};
        flatMetadata.dataTypes = invoiceKeyTypes;

        // Generate FIRS invoice dictionary using LLM
        let generatedFields = await llmService.generateInvoiceDictionary(
          "firs",
          invoice,
          flatMetadata,
        );

        // Upsert the FIRS schema to database
        const savedSchema = await transformWorkflowService.upsertFIRSSchema(
          generatedFields,
          {
            createdBy: auth?.userId || "system",
            metadata: {
              source_invoice_sample:
                metadata && metadata.source_invoice_sample
                  ? metadata.source_invoice_sample
                  : flatInvoice,
              source_metadata_sample: flatMetadata,
              generated_at: new Date().toISOString(),
            },
          },
        );

        // Audit log
        await auditService.createAuditLog({
          tenantId: auth?.tenantId,
          eventType: AuditEventType.SYSTEM_WARNING,
          severity: AuditEventSeverity.INFO,
          actorType: "user",
          actorId: auth?.userId || "admin",
          actorName: (auth as any)?.email || "Admin",
          resourceType: "firs_config",
          resourceId: savedSchema.schema_id || "firs_ubl",
          resourceName: "FIRS UBL Dictionary",
          description: "FIRS invoice dictionary updated",
          metadata: {
            schema_id: savedSchema.schema_id,
            payload: body,
          },
        });

        return {
          success: true,
          data: {
            schema_id: savedSchema.schema_id,
            name: savedSchema.name,
            fields_count: generatedFields.length,
            fields: generatedFields,
            status: savedSchema.status,
          },
        };
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    updateFIRSDictionaryValidation,
  );
