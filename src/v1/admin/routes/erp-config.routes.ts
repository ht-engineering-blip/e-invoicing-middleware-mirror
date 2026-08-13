import { Elysia } from "elysia";
import jsonSpread from "json-spread";
import { logger } from "../../../@lib";
import { LLMService } from "../../../@lib/adapters/llm/llm.service";
import { requireAdmin } from "../../../middlewares/auth";
import { onlyAdmin } from "../../auth/utils/access-checks";
import { TenantService } from "../../tenants/services/tenant.service";
import { TransformWorkflowService } from "../../workflow/services";
import { SystemConfigService } from "../services/system-config.service";
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
  /**
   * GET /admin/config/supported-erps
   * List all supported ERP systems
   */
  .get(
    "/",
    async ({ transformWorkflowService }): Promise<any> => {
      try {
        const erps = await transformWorkflowService.getSupportedERPTypes();

        return {
          success: true,
          data: erps,
          count: erps.length,
        };
      } catch (error: any) {
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
    async ({ params, transformWorkflowService }) => {
      try {
        const erp = await transformWorkflowService.getInvoiceSchema(
          params.erpType,
        );

        if (!erp) {
          return {
            success: false,
            error: `ERP type '${params.erpType}' not found`,
            statusCode: 404,
          };
        }

        return {
          success: true,
          data: erp,
        };
      } catch (error: any) {
        logger.error("Failed to fetch ERP configuration", {
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Failed to fetch ERP configuration",
          statusCode: error.statusCode || 500,
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
    async ({ auth, body, query, llmService, transformWorkflowService }) => {
      try {
        onlyAdmin(auth!);
        let { erp, invoice, metadata }: any = body;
        if (auth && auth.tenantId) {
          invoice.business_id = auth.businessId;
        }

        // Flatten the invoice for field extraction
        let flatInvoice = jsonSpread(invoice)[0];
        let flatMetadata = metadata ? jsonSpread(metadata)[0] : undefined;
        let mapping_rules =
          metadata && metadata.mapping_rules ? metadata.mapping_rules : [];

        // Generate invoice dictionary using LLM
        let generatedFields = await llmService.generateInvoiceDictionary(
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
            status: metadata.status,
            metadata: {
              ...(metadata || {}),
              source_invoice_sample:
                metadata && metadata.source_invoice_sample
                  ? metadata.source_invoice_sample
                  : flatInvoice,
              generated_at: new Date().toISOString(),
            },
            mapping_rules,
          },
        );

        return {
          success: true,
          data: {
            schema_id: savedSchema.schema_id,
            erp_type: erp,
            fields_count: generatedFields.length,
            fields: generatedFields,
            status: savedSchema.status,
          },
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    addERPDictionaryValidation,
  );
