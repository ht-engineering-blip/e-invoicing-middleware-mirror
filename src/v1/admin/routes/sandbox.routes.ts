import { Elysia } from "elysia";
import { requireAdmin } from "../../../middlewares/auth";
import { logger } from "../../../@lib";
import { SystemConfigService } from "../services/system-config.service";
import {
  testTransformValidation,
  testValidateValidation,
  testFullValidation,
} from "../validations/sandbox.validation";

/**
 * Sandbox Testing Routes
 */
export const sandboxRoutes = new Elysia({ prefix: "/sandbox" })
  .use(requireAdmin)
  .decorate("configService", new SystemConfigService())

  /**
   * POST /admin/sandbox/test-transform
   * Test invoice transformation in sandbox
   */
  .post(
    "/test-transform",
    async ({ body, configService, set }) => {
      try {
        const result = await configService.testTransform(
          body.erpType,
          body.invoice,
        );

        return {
          success: result.success,
          data: {
            transformed: result.transformed,
            original: result.original,
          },
          errors: result.errors,
        };
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Sandbox transform test failed", { error: error.message });
        return {
          success: false,
          error: error.message || "Transform test failed",
          statusCode: error.statusCode || 500,
        };
      }
    },
    testTransformValidation,
  )

  /**
   * POST /admin/sandbox/test-validate
   * Test invoice validation in sandbox
   */
  .post(
    "/test-validate",
    async ({ body, configService, set }) => {
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
        set.status = error.statusCode || 500;
        logger.error("Sandbox validate test failed", { error: error.message });
        return {
          success: false,
          error: error.message || "Validate test failed",
          statusCode: error.statusCode || 500,
        };
      }
    },
    testValidateValidation,
  )

  /**
   * POST /admin/sandbox/test-full
   * Test full transform and validate workflow
   */
  .post(
    "/test-full",
    async ({ body, configService, set }) => {
      try {
        const result = await configService.testTransformAndValidate(
          body.erpType,
          body.invoice,
        );

        return {
          success: result.success,
          data: {
            original: result.original,
            transformed: result.transformed,
            validation: result.validation,
          },
        };
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Sandbox full test failed", { error: error.message });
        return {
          success: false,
          error: error.message || "Full test failed",
          statusCode: error.statusCode || 500,
        };
      }
    },
    testFullValidation,
  );
