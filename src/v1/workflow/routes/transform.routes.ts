import Elysia from "elysia";
import { requireAuth } from "../../../middlewares";
import { TenantService } from "../../tenants/services/tenant.service";
import { TransformWorkflowService } from "../services/workflows/transform.service";
import jsonSpread from "json-spread";
import { LLMService } from "../../../@lib/adapters/llm/llm.service";
import { ResponseBuilder } from "../../../@lib";
import { onlyAdmin } from "../../auth/utils/access-checks";
import { secureAndValidateInvoice } from "../utils/security";
import {
  transformInvoiceValidation,
  configureERPDictionaryValidation,
  configureFIRSDictionaryValidation,
} from "../validations/transform.validation";

/**
 * Admin-protected tenant routes
 * All mutation operations require admin key
 */
const transformInvoiceRoutes = new Elysia({ prefix: "/transform" })
  .use(requireAuth)
  .decorate("tenantService", new TenantService())
  .decorate("transformWorkflowService", new TransformWorkflowService())
  .decorate("llmService", new LLMService())

  /**
   * POST /api/v1/workflow/transform
   * Run transform invoice workflow
   */
  .post(
    "/",
    async ({ auth, body, transformWorkflowService, set }) => {
      try {
        const { invoice: rawInvoice, source_type }: any = body;
        const invoice = secureAndValidateInvoice(
          rawInvoice as SecureInvoice,
          auth,
        );

        let transformedPayload =
          await transformWorkflowService.transformInvoiceV2(
            invoice,
            auth,
            source_type,
          );

        return ResponseBuilder.success(transformedPayload);
      } catch (error: any) {
        set.status = 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    transformInvoiceValidation,
  );

/* Dictionary Configuration */
transformInvoiceRoutes
  /**
   * POST /api/v1/workflow/transform/dictionary/erp
   * Update erp invoice dictionary for use in transformation operations
   */
  .post(
    "/dictionary/erp",
    async ({
      auth,
      body,
      query,
      llmService,
      transformWorkflowService,
      set,
    }) => {
      try {
        onlyAdmin(auth!);
        const { erp, invoice: rawInvoice, metadata }: any = body;
        const invoice = secureAndValidateInvoice(
          rawInvoice as SecureInvoice,
          auth,
        );

        // Flatten the invoice for field extraction
        let flatInvoice = jsonSpread(invoice)[0];
        let flatMetadata = metadata ? jsonSpread(metadata)[0] : undefined;

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
            metadata: {
              ...metadata,
              source_invoice_sample:
                metadata && metadata.source_invoice_sample
                  ? metadata.source_invoice_sample
                  : flatInvoice,
              generated_at: new Date().toISOString(),
            },
          },
        );

        return ResponseBuilder.success({
          schema_id: savedSchema.schema_id,
          erp_type: erp,
          fields_count: generatedFields.length,
          fields: generatedFields,
          status: savedSchema.status,
        });
      } catch (error: any) {
        set.status = 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    configureERPDictionaryValidation,
  )
  /**
   * POST /api/v1/workflow/transform/dictionary/firs
   * Configure FIRS invoice dictionary for use in transformation operations
   */
  .post(
    "/dictionary/firs",
    async ({
      auth,
      body,
      query,
      llmService,
      transformWorkflowService,
      set,
    }) => {
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

        return ResponseBuilder.success({
          schema_id: savedSchema.schema_id,
          name: savedSchema.name,
          fields_count: generatedFields.length,
          fields: generatedFields,
          status: savedSchema.status,
        });
      } catch (error: any) {
        set.status = 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    configureFIRSDictionaryValidation,
  );

export default transformInvoiceRoutes;
