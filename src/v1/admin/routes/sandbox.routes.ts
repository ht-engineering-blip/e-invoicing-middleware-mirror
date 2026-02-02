import { Elysia, t } from 'elysia';
import { requireAdmin } from '../../../middlewares/auth';
import { logger } from '../../../@lib';
import { SystemConfigService } from '../services/system-config.service';
import { SchemaSourceType } from '../../workflow/models';

/**
 * Sandbox Testing Routes
 */
export const sandboxRoutes = new Elysia({ prefix: '/sandbox' })
  .use(requireAdmin)
  .decorate('configService', new SystemConfigService())

  /**
   * POST /admin/sandbox/test-transform
   * Test invoice transformation in sandbox
   */
  .post(
    '/test-transform',
    async ({ body, configService }) => {
      try {
        const result = await configService.testTransform(body.erpType, body.invoice);

        return {
          success: result.success,
          data: {
            transformed: result.transformed,
            original: result.original
          },
          errors: result.errors,
        };
      } catch (error: any) {
        logger.error('Sandbox transform test failed', { error: error.message });
        return {
          success: false,
          error: error.message || 'Transform test failed',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({
        erpType: t.Union([t.Enum(SchemaSourceType), t.String()]),
        invoice: t.Any({default: {}}),
      }),
      detail: {
        tags: ['Admin', 'Sandbox'],
        security: [{ adminKey: [] }],
        summary: 'Test Transform',
        description: 'Test invoice transformation from ERP format to FIRS UBL format',
      },
    }
  )

  /**
   * POST /admin/sandbox/test-validate
   * Test invoice validation in sandbox
   */
  .post(
    '/test-validate',
    async ({ body, configService }) => {
      try {
        const result = await configService.testValidate(body.invoice);

        return {
          success: result.success,
          data: {
            valid: result.valid,
            errors: result.errors,
            warnings: result.warnings,
          },
        };
      } catch (error: any) {
        logger.error('Sandbox validate test failed', { error: error.message });
        return {
          success: false,
          error: error.message || 'Validate test failed',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({
        invoice: t.Any({default: {}}),
      }),
      detail: {
        tags: ['Admin', 'Sandbox'],
        security: [{ adminKey: [] }],
        summary: 'Test Validate',
        description: 'Test invoice validation against FIRS requirements',
      },
    }
  )

  /**
   * POST /admin/sandbox/test-full
   * Test full transform and validate workflow
   */
  .post(
    '/test-full',
    async ({ body, configService }) => {
      try {
        const result = await configService.testTransformAndValidate(body.erpType, body.invoice);

        return {
          success: result.success,
          data: {
            original: result.original,
            transformed: result.transformed,
            validation: result.validation,
          },
        };
      } catch (error: any) {
        logger.error('Sandbox full test failed', { error: error.message });
        return {
          success: false,
          error: error.message || 'Full test failed',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
       body: t.Object({
        erpType: t.Union([t.Enum(SchemaSourceType), t.String()]),
        invoice: t.Any({default: {}}),
      }),
      detail: {
        tags: ['Admin', 'Sandbox'],
        security: [{ adminKey: [] }],
        summary: 'Test Full Workflow',
        description: 'Test complete transform and validate workflow',
      },
    }
  );
