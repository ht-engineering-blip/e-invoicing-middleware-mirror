import { Elysia, t } from 'elysia';
import { requireAdmin } from '../../../middlewares/auth';
import { logger } from '../../../@lib';
import jsonSpread from "json-spread";
import { SystemConfigService } from '../services/system-config.service';
import { TenantService } from '../../tenants/services/tenant.service';
import { TransformWorkflowService } from '../../workflow/services';
import { LLMService } from '../../../@lib/adapters/llm/llm.service';
import { FIRS_INVOICE_METADATA, FIRS_INVOICE_SCHEMA } from '../../workflow/utils/defaults';
import { onlyAdmin } from '../../auth/utils/access-checks';
import { SchemaSourceType } from '../../workflow/models';

/**
 * FIRS Dictionary Configuration Routes
 */
export const firsConfigRoutes = new Elysia({ prefix: '/config/firs-dictionary' })
  .use(requireAdmin)
  .decorate('configService', new SystemConfigService())
  .decorate('tenantService', new TenantService())
  .decorate('transformWorkflowService', new TransformWorkflowService())
  .decorate('llmService', new LLMService())
  /**
   * GET /admin/config/firs-dictionary
   * Get current FIRS dictionary schema
   */
  .get(
    '/',
    async ({ configService, transformWorkflowService }) => {
      try {
       const firsSchemaDoc = await transformWorkflowService.getInvoiceSchema(SchemaSourceType.FIRS_UBL);
       
        if (!firsSchemaDoc) {
        return {
          schema: null,
          version: 0,
          message: 'FIRS dictionary not configured',
        };
      }
       
       return {
          success: true,
          data: firsSchemaDoc,
        };
      } catch (error: any) {
        logger.error('Failed to fetch FIRS dictionary', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to fetch FIRS dictionary',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      detail: {
        tags: ['Admin - System Configuration'],
        security: [{ adminKey: [] }],
        summary: 'Get FIRS Dictionary',
        description: 'Get the current FIRS UBL invoice schema dictionary',
      },
    }
  )

  /**
   * PUT /admin/config/firs-dictionary
   * Update FIRS dictionary schema
   */
  .put(
    '/',
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
               source_invoice_sample: flatInvoice,
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
        tags: ['Admin - System Configuration'],
        security: [{ adminKey: [] }],
        summary: 'Update FIRS Dictionary',
        description: 'Update the FIRS UBL invoice schema dictionary',
      },
    }
  );
