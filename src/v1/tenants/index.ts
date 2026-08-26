// Tenant module routes
import { Elysia } from "elysia";
import { logger, UnauthorizedError } from "../../@lib";
import { requireAuth } from "../../middlewares/auth";
import { TenantService } from "./services/tenant.service";
import {
  tenantIdParamValidator,
  updateFirsCredentialsValidator,
} from "./utils/tenant.validators";

import { onlySelf } from "../auth/utils/access-checks";
import adminTenantRoutes from "./routes/admin.routes";
import {
  protectedOnboardingRoutes,
  publicOnboardingRoutes,
} from "./routes/onboarding.routes";
import { settingsRoutes } from "./routes/settings.routes";
import { protectedTeamRoutes, publicTeamRoutes } from "./routes/team.routes";

/**
 * Auth-protected onboarding route
 * Accepts both API key and JWT token
 */
const authOnboardingRoutes = new Elysia()
  .use(requireAuth)
  .decorate("tenantService", new TenantService())

  /**
   * PUT /api/v1/tenants/:tenantId/firs-credentials
   * Update FIRS credentials for a tenant
   */
  .put(
    "/:tenantId/firs-credentials",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        // Map validator fields to service input
        const credentials = {
          certificate: body.certificate,
          publicKey: body.publicKey,
        };
        let targetTenantId = params.tenantId;
        if (targetTenantId === "me" && auth?.tenantId) {
          targetTenantId = auth.tenantId;
        }

        if (
          auth?.tenantId !== targetTenantId &&
          auth?.businessId !== targetTenantId &&
          !auth?.isAdmin
        ) {
          throw new UnauthorizedError("Invalid token used for this tenant");
        }

        const tenant = await tenantService.getTenantById(targetTenantId);
        if (tenant) {
          const tenantUpdateResp = await tenantService.updateFIRSCredentials(
            targetTenantId,
            credentials,
          );

          // Automatically update onboarding step - mark FIRS provisioning as complete
          try {
            const onboarding =
              await tenantService.getOnboardingStatus(targetTenantId);
            if (onboarding && !onboarding.steps?.firsProvisioning?.completed) {
              await tenantService.completeOnboardingStep(
                targetTenantId,
                "firsProvisioning",
              );

              // Update status to in_progress if still pending
              if (onboarding.status === "pending") {
                await tenantService.updateOnboarding(targetTenantId, {
                  status: "in_progress",
                });
              }
            }
          } catch (onboardingError) {
            // Don't fail the main operation if onboarding update fails
            logger.warn("Failed to update onboarding status:", onboardingError);
          }

          return {
            success: true,
            message: "FIRS credentials updated successfully",
            data: {
              tenantId: tenant.tenantId,
              firsCredentialsConfigured: true,
              onboardingStepCompleted: "firsProvisioning",
            },
          };
        } else {
          throw new UnauthorizedError("Tenant not found");
        }
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      params: tenantIdParamValidator,
      body: updateFirsCredentialsValidator,
      detail: {
        tags: ["Tenant"],
        security: [{ adminKey: [] }, { bearerAuth: [] }],
        summary: "Update FIRS credentials",
        description:
          "Update FIRS API credentials (username, password, certificates)",
      },
    },
  )

  /**
   * GET /api/v1/tenants/:tenantId/onboarding
   * Get onboarding status for a tenant
   */
  .get(
    "/:tenantId/onboarding",
    async ({ params, auth, tenantService, set }) => {
      try {
        logger.info("Auth", auth);

        // Verify the user has access to this tenant
        onlySelf(auth!, params.tenantId);
        /* if (auth?.tenantId !== params.tenantId && !auth?.isAdmin) {
          return {
            success: false,
            error: 'Forbidden: You do not have access to this tenant',
            statusCode: 403,
          };
        } */

        const onboarding = await tenantService.getOnboardingStatus(
          params.tenantId,
        );

        // Calculate onboarding progress
        let onboardingProgress = 0;
        if (onboarding?.steps) {
          const steps = onboarding.steps;
          const completedSteps = Object.values(steps).filter(
            (step: any) => step.completed,
          ).length;
          const totalSteps = Object.keys(steps).length;
          onboardingProgress = Math.round((completedSteps / totalSteps) * 100);
        }
        return {
          success: true,
          data: { onboarding, progress: onboardingProgress },
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
    {
      params: tenantIdParamValidator,
      detail: {
        tags: ["Tenant"],
        security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }],
        summary: "Get onboarding status",
        description:
          "Retrieve onboarding progress for a tenant (requires authentication)",
      },
    },
  );

/**
 * Tenant Management Routes
 * Combines admin-protected and auth-protected routes
 */
export const tenantRoutes = new Elysia({ prefix: "/tenants" })
  .use(adminTenantRoutes)
  .use(authOnboardingRoutes)
  .use(publicOnboardingRoutes)
  .use(protectedOnboardingRoutes)
  .use(protectedTeamRoutes)
  .use(settingsRoutes);

/**
 * Public Team Routes (separate prefix)
 */
export const teamPublicRoutes = publicTeamRoutes;
