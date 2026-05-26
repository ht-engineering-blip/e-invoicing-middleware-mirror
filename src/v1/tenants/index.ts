// Tenant module routes
import { Elysia, t } from 'elysia';
import {
  createTenantValidator,
  updateTenantValidator,
  updateFirsCredentialsValidator,
  tenantIdParamValidator,
  listTenantsQueryValidator,
  createApiKeyValidator,
  apiKeyIdParamValidator,
  revokeApiKeyValidator,
  updateOnboardingStatusValidator,
  erpSyncConfigValidator,
} from './utils/tenant.validators';
import { requireAdmin, requireAuth } from '../../middlewares/auth';
import { logger, UnauthorizedError } from '../../@lib';
import { TenantService } from './services/tenant.service';

import adminTenantRoutes from "./routes/admin"
import { onlySelf } from '../auth/utils/access-checks';
import { publicOnboardingRoutes, protectedOnboardingRoutes } from './routes/onboarding.routes';
import { publicTeamRoutes, protectedTeamRoutes } from './routes/team.routes';
import { settingsRoutes } from './routes/settings.routes';

/**
 * Auth-protected onboarding route
 * Accepts both API key and JWT token
 */
const authOnboardingRoutes = new Elysia()
  .use(requireAuth)
  .decorate('tenantService', new TenantService())

  /**
   * PUT /api/v1/tenants/:tenantId/firs-credentials
   * Update FIRS credentials for a tenant
   */
  .put(
    '/:tenantId/firs-credentials',
    async ({ auth, params, body, tenantService }) => {
      try {
        // Map validator fields to service input
        const credentials = {
          certificate: body.certificate,
          publicKey: body.publicKey
        };
        if (auth?.tenantId !== params.tenantId) {
          throw new UnauthorizedError("Invalid token used for this tenant");
        }

        const tenant = await tenantService.getTenantById(params.tenantId);
        if (tenant) {


          const tenantUpdateResp = await tenantService.updateFIRSCredentials(params.tenantId, credentials);

          // Automatically update onboarding step - mark FIRS provisioning as complete
          try {
            const onboarding = await tenantService.getOnboardingStatus(params.tenantId);
            if (onboarding && !onboarding.steps?.firsProvisioning?.completed) {
              await tenantService.completeOnboardingStep(params.tenantId, 'firsProvisioning');

              // Update status to in_progress if still pending
              if (onboarding.status === 'pending') {
                await tenantService.updateOnboarding(params.tenantId, {
                  status: 'in_progress',
                });
              }
            }
          } catch (onboardingError) {
            // Don't fail the main operation if onboarding update fails
            logger.warn('Failed to update onboarding status:', onboardingError);
          }

          return {
            success: true,
            message: 'FIRS credentials updated successfully',
            data: {
              tenantId: tenant.tenantId,
              firsCredentialsConfigured: true,
              onboardingStepCompleted: 'firsProvisioning',
            },
          };
        } else {
          throw new UnauthorizedError("Tenant not found");
        }
      } catch (error: any) {
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
        tags: ['Tenant'],
        security: [{ adminKey: [] }, { bearerAuth: [] }],
        summary: 'Update FIRS credentials',
        description: 'Update FIRS API credentials (username, password, certificates)',
      },
    }
  )

  /**
   * GET /api/v1/tenants/:tenantId/onboarding
   * Get onboarding status for a tenant
   */
  .get(
    '/:tenantId/onboarding',
    async ({ params, auth, tenantService, set }) => {
      try {
        logger.info("Auth", auth);

        // Verify the user has access to this tenant
        onlySelf(auth!, params.tenantId)
        /* if (auth?.tenantId !== params.tenantId && !auth?.isAdmin) {
          return {
            success: false,
            error: 'Forbidden: You do not have access to this tenant',
            statusCode: 403,
          };
        } */

        const onboarding = await tenantService.getOnboardingStatus(params.tenantId);

        // Calculate onboarding progress
        let onboardingProgress = 0;
        if (onboarding?.steps) {
          const steps = onboarding.steps;
          const completedSteps = Object.values(steps).filter(
            (step: any) => step.completed
          ).length;
          const totalSteps = Object.keys(steps).length;
          onboardingProgress = Math.round((completedSteps / totalSteps) * 100);
        }
        return {
          success: true,
          data: { onboarding, progress: onboardingProgress },
        };
      } catch (error: any) {
        set.status = 500
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
        tags: ['Tenant'],
        security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }],
        summary: 'Get onboarding status',
        description: 'Retrieve onboarding progress for a tenant (requires authentication)',
      },
    }
  );

/**
 * Tenant Management Routes
 * Combines admin-protected and auth-protected routes
 */
export const tenantRoutes = new Elysia({ prefix: '/tenants' })
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
