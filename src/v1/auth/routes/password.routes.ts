import { Elysia } from "elysia";
import { logger, ResponseBuilder } from "../../../@lib";
import { AuthService } from "../services";
import {
  forgotPasswordRouteValidation,
  resetPasswordRouteValidation,
  validateResetTokenRouteValidation,
  setPasswordRouteValidation,
} from "../validations/auth.validation";

export const authPasswordRoutes = new Elysia()
  .decorate("authService", new AuthService())

  /**
   * POST /auth/forgot-password
   * Request password reset
   */
  .post(
    "/forgot-password",
    async ({ body, authService, set }) => {
      try {
        const result = await authService.requestPasswordReset(body.email);
        return ResponseBuilder.success(result, undefined, result.message);
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Forgot password failed", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to process password reset",
          error.statusCode || 500,
        );
      }
    },
    forgotPasswordRouteValidation,
  )

  /**
   * POST /auth/reset-password
   * Reset password using token
   */
  .post(
    "/reset-password",
    async ({ body, authService, set }) => {
      try {
        const passwordToSet = body.password || (body as any).newPassword;
        const result = await authService.resetPassword(body.token, passwordToSet);
        return ResponseBuilder.success(result, undefined, result.message);
      } catch (error: any) {
        set.status = error.statusCode || 400;
        logger.error("Password reset failed", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to reset password",
          error.statusCode || 400,
        );
      }
    },
    resetPasswordRouteValidation,
  )

  /**
   * GET /auth/validate-reset-token
   * Validate password reset token
   */
  .get(
    "/validate-reset-token",
    async ({ query, authService, set }) => {
      try {
        const result = await authService.validateResetToken(query.token);
        if (!result.valid) {
          set.status = 400;
          return ResponseBuilder.error("Invalid or expired reset token", 400);
        }
        return ResponseBuilder.success(result, undefined, "Token is valid");
      } catch (error: any) {
        set.status = 400;
        return ResponseBuilder.error("Failed to validate reset token", 400);
      }
    },
    validateResetTokenRouteValidation,
  )

  /**
   * POST /auth/set-password
   * Set initial password
   */
  .post(
    "/set-password",
    async ({ body, authService, set }) => {
      try {
        const tenantId = (body as any).tenantId;
        const result = await authService.setPassword(tenantId, body.password);
        return ResponseBuilder.success(result, undefined, result.message);
      } catch (error: any) {
        set.status = error.statusCode || 400;
        logger.error("Set password failed", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to set password",
          error.statusCode || 400,
        );
      }
    },
    setPasswordRouteValidation,
  );
