import { Elysia, t } from 'elysia';
import { requireAdmin } from '../../../middlewares/auth';
import { logger } from '../../../@lib';
import jsonSpread from "json-spread";
import { SystemConfigService } from '../services/system-config.service';
import { TenantService } from '../../tenants/services/tenant.service';
import { TransformWorkflowService } from '../../workflow/services';
import { LLMService } from '../../../@lib/adapters/llm/llm.service';
import { SchemaSourceType } from '../../workflow/models';
import { onlyAdmin } from '../../auth/utils/access-checks';

/**
 * ERP Configuration Routes
 */
export const erpConfigRoutes = new Elysia({ prefix: '/config/supported-erps' })
  .use(requireAdmin)
  .decorate('configService', new SystemConfigService())
  .decorate('tenantService', new TenantService())
  .decorate('transformWorkflowService', new TransformWorkflowService())
  .decorate('llmService', new LLMService())
  /**
   * GET /admin/config/supported-erps
   * List all supported ERP systems
   */
  .get(
    '/',
    async ({ configService, transformWorkflowService }): Promise<any> => {
      try {

        const supportedERPs = await transformWorkflowService.getSupportedERPTypes();

        return {
          success: true,
          data: supportedERPs,
          count: supportedERPs.length,
        };
      } catch (error: any) {
        logger.error('Failed to fetch supported ERPs', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to fetch supported ERPs',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      response: {
        200: t.Object({
          success: t.Literal(true),
          data: t.Array(
            t.Object({
              id: t.String(),
              source_type: t.String(),
              status: t.String(),
              last_updated: t.Date(),
            })
          ),
          count: t.Number(),
        }),
        500: t.Object({
          success: t.Literal(false),
          error: t.String(),
          statusCode: t.Number(),
        }),
      },
      detail: {
        tags: ['Admin - System Configuration'],
        security: [{ adminKey: [] }],
        summary: 'List Supported ERPs',
        description: 'Get all configured ERP systems (excludes FIRS_UBL)',
      },
    }
  )

  /**
   * GET /admin/config/supported-erps/:erpType
   * Get a specific ERP configuration
   */
  .get(
    '/:erpType',
    async ({ params, configService, transformWorkflowService }) => {
      try {
        //const erp = await configService.getERPByType(params.erpType);
        const erp = await transformWorkflowService.getInvoiceSchema(params.erpType);


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
        logger.error('Failed to fetch ERP configuration', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to fetch ERP configuration',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      params: t.Object({
        erpType: t.Union([t.Enum(SchemaSourceType), t.String()]),
      }),
      detail: {
        tags: ['Admin - System Configuration'],
        security: [{ adminKey: [] }],
        summary: 'Get ERP Dictionary',
        description: 'Get invoice dictionary for a specific ERP type',
      },
    }
  )

  /**
   * POST /admin/config/supported-erps
   * Add a new ERP configuration
   */
  .post(
    '/',
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
            status: metadata.status,
            metadata: {
              source_invoice_sample: flatInvoice,
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
        erp: t.Union([
          t.Enum(SchemaSourceType, { default: SchemaSourceType.CUSTOM, }),
          t.String()
        ]),
        invoice: t.Any({ default: {} }),
        metadata: t.Optional(t.Any()),
      }),
      detail: {
        tags: ['Admin - System Configuration'],
        security: [{ adminKey: [] }],
        summary: 'Add ERP Dictionary',
        description: 'Add a new ERP system invoice dictionary',
      },
    }
  );