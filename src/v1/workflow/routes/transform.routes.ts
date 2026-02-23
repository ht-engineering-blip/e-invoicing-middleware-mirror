import Elysia, { t } from "elysia";
import { requireAuth } from "../../../middlewares";
import { TenantService } from "../../tenants/services/tenant.service";
import { TransformWorkflowService } from "../services/workflows/transform.service";
import jsonSpread from "json-spread";
import { LLMService } from "../../../@lib/adapters/llm/llm.service";
import { onlyAdmin } from "../../auth/utils/access-checks";
import { SchemaSourceType } from "../models";
import { FIRS_INVOICE_METADATA, FIRS_INVOICE_SCHEMA } from "../utils/defaults";
import { flatten } from "../../../@lib";

/**
 * Admin-protected tenant routes
 * All mutation operations require admin key
 */
const transformInvoiceRoutes = new Elysia({ prefix: '/transform' })
  .use(requireAuth)
  .decorate('tenantService', new TenantService())
  .decorate('transformWorkflowService', new TransformWorkflowService())
  .decorate('llmService', new LLMService())


  /**
   * POST /api/v1/workflow/transform
   * Run transform invoice workflow
   */
  .post(
    '/',
    async ({ auth, body, query, tenantService, transformWorkflowService }) => {
      try {
        let { invoice, source_type }: any = body
        if (auth && auth.tenantId) {
          invoice.business_id = auth.businessId
        }

        let transformedPayload = await transformWorkflowService.transformInvoice(
          invoice,
          auth,
          source_type
        );

        return {
          success: true,
          data: transformedPayload
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({
        invoice: t.Any({ default: {} }),
        source_type: t.Optional(t.Enum(SchemaSourceType, { default: SchemaSourceType.CUSTOM })),
      }),
      detail: {
        summary: 'Transform Invoice',
        description: 'Transform invoice from source ERP format to FIRS UBL format using schema-based mapping',
      },
    }
  );

  /* Dictionary Configuration */
  transformInvoiceRoutes 
  /**
   * POST /api/v1/workflow/transform/dictionary/erp
   * Update erp invoice dictionary for use in transformation operations
   */
  .post(
    '/dictionary/erp',
    async ({ auth, body, query, llmService, transformWorkflowService }) => {
      try {
        onlyAdmin(auth!)
        let { erp, invoice, metadata }: any = body
        if (auth && auth.tenantId) {
          invoice.business_id = auth.businessId
        }

        // Flatten the invoice for field extraction
        let flatInvoice = jsonSpread(invoice)[0]
        let flatMetadata = metadata ? jsonSpread(metadata)[0] : undefined

        // Generate invoice dictionary using LLM
        let generatedFields = await llmService.generateInvoiceDictionary(erp, flatInvoice, flatMetadata)

        // Upsert the schema to database
        const savedSchema = await transformWorkflowService.upsertERPSchema(
          erp,
          generatedFields,
          {
            tenantId: auth?.tenantId,
            createdBy: auth?.userId || 'system',
            metadata: {
              ...metadata,
              source_invoice_sample: metadata && metadata.source_invoice_sample ? metadata.source_invoice_sample:  flatInvoice,
              generated_at: new Date().toISOString(),
            },
          }
        )

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
    {
      body: t.Object({
        erp: t.Enum(SchemaSourceType, { default: SchemaSourceType.CUSTOM, }),
        invoice: t.Any({ default: {} }),
        metadata: t.Optional(t.Any()),
      }),
      detail: {
        hide: true,
        tags: ['Admin - System Configuration.Bak'],
        security: [{ adminKey: [] }],
        summary: 'Configure ERP Invoice Dictionary',
        description: 'Creates and updates invoice dictionary used for mapping for supported ERPs. Extracts field definitions from sample invoice.',
      },
    }
  )
  /**
   * POST /api/v1/workflow/transform/dictionary/firs
   * Configure FIRS invoice dictionary for use in transformation operations
   */
  .post(
    '/dictionary/firs',
    async ({ auth, body, query, llmService, transformWorkflowService }) => {
      try {
        onlyAdmin(auth!)
        let { invoice, metadata }: any = body

        // Flatten the invoice and metadata for field extraction
        let flatInvoice = jsonSpread(invoice)[0]
        let invoiceKeyTypes: any = {}
       /*  Object.keys(invoice).forEach(key => {
          const value = invoice[key];
          invoiceKeyTypes[key] = typeof value
        }); */
        let flatMetadata = metadata ? jsonSpread(metadata)[0] : {}
        flatMetadata.dataTypes = invoiceKeyTypes

        // Generate FIRS invoice dictionary using LLM
        let generatedFields = await llmService.generateInvoiceDictionary('firs', invoice, flatMetadata)

        // Upsert the FIRS schema to database
        const savedSchema = await transformWorkflowService.upsertFIRSSchema(
          generatedFields,
          {
            createdBy: auth?.userId || 'system',
            metadata: {
              source_invoice_sample: metadata && metadata.source_invoice_sample ? metadata.source_invoice_sample: flatInvoice,
              source_metadata_sample: flatMetadata,
              generated_at: new Date().toISOString(),
            },
          }
        )

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
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({
        invoice: t.Any({ default: FIRS_INVOICE_SCHEMA }),
        metadata: t.Optional(t.Any({ default: FIRS_INVOICE_METADATA })),
      }),
      detail: {
        hide: true,
        tags: ['Admin - System Configuration.Bak'],
        security: [{ adminKey: [] }],
        summary: 'Configure FIRS Dictionary',
        description: 'Creates and updates FIRS UBL invoice dictionary. Extracts field definitions from sample FIRS invoice and metadata.',
      },
    }
  )
 

export default transformInvoiceRoutes;