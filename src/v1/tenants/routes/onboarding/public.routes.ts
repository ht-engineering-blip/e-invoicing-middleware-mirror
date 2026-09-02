import { Elysia } from "elysia";
import * as jwt from "jsonwebtoken";
import { jwtConfig, appConfig } from "../../../../@config";
import { logger, ResponseBuilder } from "../../../../@lib";
import { TenantService } from "../../services/tenant.service";
import { activateValidation } from "../../validations/onboarding.validation";

/**
 * Public Onboarding Routes (no auth required)
 */
export const publicOnboardingRoutes = new Elysia()
  .decorate("tenantService", new TenantService())

  /**
   * GET /tenants/activate/:token
   * Handle activation link click
   */
  .get(
    "/activate/:token",
    async ({ params, tenantService, set }) => {
      try {
        logger.info("Activation link clicked");

        // Verify JWT token
        const jwtSecret = jwtConfig?.secret as string;
        let decoded: any;

        try {
          decoded = jwt.verify(params.token, jwtSecret, {
            algorithms: [(jwtConfig?.algorithm as jwt.Algorithm) || "HS256"],
          });
        } catch (jwtError: any) {
          set.status = 400;
          logger.warn("Invalid activation token", { error: jwtError.message });
          return ResponseBuilder.error(
            "Invalid or expired activation link",
            400,
          );
        }

        if (!decoded.tenantId) {
          set.status = 400;
          return ResponseBuilder.error("Invalid activation token", 400);
        }

        // Get tenant
        const tenant = await tenantService.getTenantById(decoded.tenantId);

        // Check if already activated
        if (tenant.password || tenant.metadata?.activationCompleted) {
          set.status = 400;
          return ResponseBuilder.error(
            "Account has already been activated",
            400,
          );
        }

        // Verify single active token ID match and expiration using service helpers
        if (
          !tenantService.isActivationTokenValid(
            tenant,
            decoded.activationTokenId,
          )
        ) {
          set.status = 400;
          logger.warn(
            "Activation token is invalid or expired (ID mismatch or timeframe expired)",
            {
              tenantId: tenant.tenantId,
              dbTokenId: tenant.metadata?.activationTokenId,
              decodedTokenId: decoded.activationTokenId,
              expiresAt: tenantService.getActivationTokenExpiry(tenant),
            },
          );
          return ResponseBuilder.error(
            "Invalid or expired activation link",
            400,
          );
        }

        // Generate a new short-lived token for password setting
        const setPasswordToken = jwt.sign(
          {
            tenantId: tenant.tenantId,
            email: tenant.contactEmail,
            purpose: "set-password",
          },
          jwtSecret,
          {
            expiresIn: "1h",
            algorithm: (jwtConfig?.algorithm as jwt.Algorithm) || "HS256",
          },
        );

        // Return redirect info or token
        const webAppUrl = appConfig?.webAppURL || "http://localhost:3000";
        const redirectUrl = `${webAppUrl}/auth/set-password?token=${setPasswordToken}`;

        return ResponseBuilder.success(
          {
            tenantId: tenant.tenantId,
            businessName: tenant.businessName,
            email: tenant.contactEmail,
            setPasswordToken,
            redirectUrl,
          },
          undefined,
          "Activation link valid",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Activation link handling failed", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to process activation link",
          error.statusCode || 500,
        );
      }
    },
    activateValidation,
  );
