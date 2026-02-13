// Tenant module routes
import { Elysia, t } from 'elysia';
import {
  createTenantValidator,
  updateTenantValidator,
  tenantIdParamValidator,
  listTenantsQueryValidator,
  apiKeyIdParamValidator,
  revokeApiKeyValidator,
  updateOnboardingStatusValidator,
  createApiKeyValidator,
  erpSyncConfigValidator
} from '../utils/tenant.validators';
import { requireAdmin, requireAuth } from '../../../middlewares/auth';
import { logger, UnauthorizedError } from '../../../@lib';
import { TenantService } from '../services/tenant.service';
import { appConfig } from '../../../@config';
import { MailContent, withTemplate } from '../../../@lib/messaging';
import { AuthService } from '../../auth/services';
import { onlyAdmin, onlySelf } from '../../auth/utils/access-checks';

/**
 * Admin-protected tenant routes
 * All mutation operations require admin key
 */
/*   prefix: '/admin', */
const adminTenantRoutes = new Elysia({
 detail: {
    hide: appConfig?.env === 'production'
  }
})
  .use(requireAuth)
  .decorate('tenantService', new TenantService())
  .decorate('authService', new AuthService())


  /**
 * POST /api/v1/tenants
 * Create a new tenant
 */
  .post(
    '/',
    async ({ body, tenantService, authService }) => {
      try {
        const tenant = await tenantService.createTenant(body);

        /* Notify Tenant to complete onboarding */
        let activationToken = await authService.createAuthToken(tenant as any, "12HRS")
        let activationLink = `${appConfig?.webAppURL}/auth/activate?_u=${activationToken}`;
        let activationEmail: MailContent = {
          subject: 'Welcome to HT Invoicing',
          html: withTemplate(`<p>Welcome to HT Invoicing. Your account has been created successfully.</p>
                            <p>Click the button below to get started</p>
                            <a href="${activationLink}" class="cta-button">Get Started</a>
                            <br/>
                             or copy the link: 
                            <a href="${activationLink}" style="text-decoration: none;">${activationLink}</a>`),
        }
        await tenantService.notifyTenant(activationEmail, tenant)

        return {
          success: true,
          message: 'Tenant created successfully',
          data: tenant,
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
      body: createTenantValidator,
      detail: {
        tags: ['Admin - Tenants'],
        security: [{ adminKey: [] }],
        summary: 'Create a new tenant',
        description: 'Create a new tenant with business information and ERP configuration',
      },
    }
  )

  /**
   * GET /api/v1/tenants
   * List all tenants with pagination and filtering
   */
  .get(
    '/',
    async ({ query, tenantService }) => {
      try {
        console.log({ query })
        const page = query.page || 1;
        const limit = query.limit || 20;
        const includeOnboarding = query.onboarding || true;
        const skip = (page - 1) * limit;

        const result = await tenantService.listTenants({
          status: query.status,
          skip,
          limit,
          includeOnboarding
        });

        return {
          success: true,
          data: result.tenants,
          pagination: {
            page,
            limit,
            total: result.total,
            totalPages: Math.ceil(result.total / limit),
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
      query: listTenantsQueryValidator,
      detail: {
        tags: ['Admin - Tenants'],
        security: [{ adminKey: [] }],
        summary: 'List all tenants',
        description: 'Get paginated list of tenants with optional filtering',
      },
    }
  )

  /**
 * GET /api/v1/tenants/:tenantId
 * Get tenant by ID
 */
  .get(
    '/:tenantId',
    async ({ auth, params, tenantService }) => {
      try {
        // Verify the user has access to this tenant
        onlySelf(auth!, params.tenantId)
        const tenant = await tenantService.getTenantById(params.tenantId, true);
        return {
          success: true,
          data: tenant,
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
      params: tenantIdParamValidator,
      detail: {
        tags: ['Admin - Tenants', 'Tenant',],
        security: [{ adminKey: [] }, { bearerToken: [] }],
        summary: 'Get tenant by ID',
        description: 'Retrieve detailed information about a specific tenant',
      },
    }
  )

  /**
   * PATCH /api/v1/tenants/:tenantId
   * Update tenant information
   */
  .patch(
    '/:tenantId',
    async ({ auth, params, body, tenantService }) => {
      try {
        // Verify access
        onlyAdmin(auth!, params.tenantId)
        const tenant = await tenantService.updateTenant(params.tenantId, body);
        return {
          success: true,
          message: 'Tenant updated successfully',
          data: tenant,
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
      params: tenantIdParamValidator,
      body: updateTenantValidator,
      detail: {
        tags: ['Admin - Tenants'],
        security: [{ adminKey: [] }],
        summary: 'Update tenant',
        description: 'Update tenant information (business details, limits, features)',
      },
    }
  )

  /**
   * POST /api/v1/tenants/:tenantId/activate
   * Activate a tenant
   */
  .post(
    '/:tenantId/activate',
    async ({ auth, params, tenantService }) => {
      try {
        // Verify access
        onlyAdmin(auth!, 'Forbidden: You are not authorized to activate this tenant')


        const tenant = await tenantService.activateTenant(params.tenantId);
        return {
          success: true,
          message: 'Tenant activated successfully',
          data: tenant,
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
      params: tenantIdParamValidator,
      detail: {
        tags: ['Admin - Tenants'],
        security: [{ adminKey: [] }],
        summary: 'Activate tenant',
        description: 'Activate a suspended tenant account',
      },
    }
  )

  /**
   * POST /api/v1/tenants/:tenantId/suspend
   * Suspend a tenant
   */
  .post(
    '/:tenantId/suspend',
    async ({ auth, params, tenantService }) => {
      try {
        // Verify access
        onlyAdmin(auth!, 'Forbidden: You are not authorized to suspend this tenant')

        const tenant = await tenantService.suspendTenant(params.tenantId);
        return {
          success: true,
          message: 'Tenant suspended successfully',
          data: tenant,
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
      params: tenantIdParamValidator,
      detail: {
        tags: ['Admin - Tenants'],
        security: [{ adminKey: [] }],
        summary: 'Suspend tenant',
        description: 'Suspend a tenant account (reversible)',
      },
    }
  )

  /**
   * DELETE /api/v1/tenants/:tenantId
   * Delete a tenant
   */
  .delete(
    '/:tenantId',
    async ({ auth, params, tenantService }) => {
      try {
        // Verify access
        onlyAdmin(auth!, 'Forbidden: You are not authorized to delete this tenant')

        await tenantService.deleteTenant(params.tenantId);
        return {
          success: true,
          message: 'Tenant deleted successfully',
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
      params: tenantIdParamValidator,
      detail: {
        tags: ['Admin - Tenants'],
        security: [{ adminKey: [] }],
        summary: 'Delete tenant',
        description: 'Permanently delete a tenant (use with caution)',
      },
    }
  )
  /**
   * PATCH /api/v1/tenants/:tenantId/onboarding
   * Update onboarding status
   */
  .patch(
    '/:tenantId/onboarding',
    async ({ params, body, tenantService }) => {
      try {
        const onboarding = await tenantService.updateOnboarding(params.tenantId, body);
        return {
          success: true,
          message: 'Onboarding status updated successfully',
          data: onboarding,
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
      params: tenantIdParamValidator,
      body: updateOnboardingStatusValidator,
      detail: {
        tags: ['Admin - Tenants'],
        security: [{ adminKey: [] }],
        summary: 'Update onboarding status',
        description: 'Update the onboarding progress for a tenant',
      },
    }
  )


/* API Keys Endpoints */
//adminTenantRoutes

  /**
   * POST /api/v1/tenants/:tenantId/api-keys
   * Create a new API key for a tenant
   */
  .post(
    '/:tenantId/api-keys',
    async ({ params, body, tenantService }) => {
      try {
        const result = await tenantService.createApiKey(params.tenantId, body);
        return {
          success: true,
          message: 'API key created successfully',
          data: {
            ...result.apiKey,
            key: result.plainKey, // Only returned once
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
      params: tenantIdParamValidator,
      body: createApiKeyValidator,
      detail: {
        tags: ['Admin - API Keys'],
        security: [{ adminKey: [] }],
        summary: 'Create API key',
        description: 'Generate a new API key for tenant authentication',
      },
    }
  )

  /**
  * GET /api/v1/tenants/:tenantId/api-keys
  * List API keys for a tenant
  */
  .get(
    '/:tenantId/api-keys',
    async ({ params, tenantService }) => {
      try {
        const apiKeys = await tenantService.listApiKeys(params.tenantId);
        return {
          success: true,
          data: apiKeys,
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
      params: tenantIdParamValidator,
      detail: {
        tags: ['Admin - API Keys'],
        security: [{ adminKey: [] }],
        summary: 'List API keys',
        description: 'Get all API keys for a tenant',
      },
    }
  )

  /**
   * DELETE /api/v1/tenants/:tenantId/api-keys/:keyId
   * Revoke an API key
   */
  .delete(
    '/:tenantId/api-keys/:keyId',
    async ({ params, body, tenantService }) => {
      try {
        await tenantService.revokeApiKey(params.tenantId, params.keyId, body?.reason);
        return {
          success: true,
          message: 'API key revoked successfully',
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
      params: t.Composite([tenantIdParamValidator, apiKeyIdParamValidator]),
      body: revokeApiKeyValidator,
      detail: {
        tags: ['Admin - API Keys'],
        security: [{ adminKey: [] }],
        summary: 'Revoke API key',
        description: 'Permanently revoke an API key',
      },
    }
  )

  /**
   * POST /api/v1/tenants/:tenantId/api-keys/:keyId/rotate
   * Rotate an API key (revoke old and create new)
   */
  .post(
    '/:tenantId/api-keys/:keyId/rotate',
    async ({ params, body, tenantService }) => {
      try {
        const result = await tenantService.rotateApiKey(params.tenantId, params.keyId, {
          sendEmail: body?.sendEmail !== false,
          reason: body?.reason,
        });

        return {
          success: true,
          message: 'API key rotated successfully. New key sent via email.',
          data: {
            ...result.apiKey,
            key: result.plainKey, // Only returned once
            emailSent: body?.sendEmail !== false,
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
      params: t.Composite([tenantIdParamValidator, apiKeyIdParamValidator]),
      body: t.Object({
        reason: t.Optional(t.String()),
        sendEmail: t.Optional(t.Boolean({ default: true })),
      }),
      detail: {
        tags: ['Admin - API Keys'],
        security: [{ adminKey: [] }],
        summary: 'Rotate API key',
        description: 'Revoke old API key and generate a new one. Tenant receives an email with the new key.',
      },
    }
  )

  /**
   * GET /api/v1/tenants/api-keys
   * List all API keys across all tenants (Admin only)
   */
  .get(
    '/api-keys',
    async ({ auth, query, tenantService }) => {
      try {
        // Verify admin access
        onlyAdmin(auth!, 'Forbidden: Admin access required');

        const page = query.page || 1;
        const limit = query.limit || 50;
        const skip = (page - 1) * limit;

        const result = await tenantService.listAllApiKeys({
          status: query.status,
          tenantId: query.tenantId,
          skip,
          limit,
        });

        return {
          success: true,
          data: result.apiKeys,
          pagination: {
            page,
            limit,
            total: result.total,
            totalPages: Math.ceil(result.total / limit),
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
      query: t.Object({
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        status: t.Optional(t.String()),
        tenantId: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Admin - API Keys'],
        security: [{ adminKey: [] }],
        summary: 'List all API keys',
        description: 'Get a list of all API keys across all tenants with filtering and pagination. Admin only.',
      },
    }
  )

/* ERP Sync Configuration */
//adminTenantRoutes
  /**
   * GET /api/v1/tenants/erp-configs
   * List all ERP configurations across all tenants (Admin only)
   */
  .get(
    '/erp-configs',
    async ({ auth, query, tenantService }) => {
      try {
        // Verify admin access
        onlyAdmin(auth!, 'Forbidden: Admin access required');

        const page = query.page || 1;
        const limit = query.limit || 50;
        const skip = (page - 1) * limit;

        const result = await tenantService.listAllERPConfigs({
          erpSystem: query.erpSystem,
          enabled: query.enabled !== undefined ? query.enabled === 'true' : undefined,
          skip,
          limit,
        });

        return {
          success: true,
          data: result.configs,
          pagination: {
            page,
            limit,
            total: result.total,
            totalPages: Math.ceil(result.total / limit),
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
      query: t.Object({
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        erpSystem: t.Optional(t.String()),
        enabled: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Admin - ERP Integration'],
        security: [{ adminKey: [] }],
        summary: 'List all ERP configurations',
        description: 'Get a list of all ERP configurations across all tenants with filtering options',
      },
    }
  )

  /**
    * PUT /api/v1/tenants/:tenantId/erp-sync
    * Configure ERP sync settings for dynamic REST calls
    */
  .put(
    '/:tenantId/erp-sync',
    async ({ auth, params, body, tenantService }) => {
      try {
        // Verify the user has access to this tenant
        if (auth?.tenantId !== params.tenantId && !auth?.isAdmin) {
          return {
            success: false,
            error: 'Forbidden: You do not have access to this tenant',
            statusCode: 403,
          };
        }
        const _updatedTenant = await tenantService.configureERPSync(params.tenantId, body);

        // Automatically update onboarding step - mark FIRS provisioning as complete
        try {
          const onboarding = await tenantService.getOnboardingStatus(params.tenantId);
          if (onboarding && !onboarding.steps?.erpConfiguration?.completed) {
            await tenantService.completeOnboardingStep(params.tenantId, 'erpConfiguration');

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
          message: 'ERP sync configuration updated successfully',
          data: {
            tenantId: params.tenantId,
            configName: body.name,
            enabled: body.enabled,
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
      params: tenantIdParamValidator,
      body: erpSyncConfigValidator,
      detail: {
        tags: ['Admin - ERP Integration', 'Tenant'],
        security: [{ adminKey: [] }],
        summary: 'Configure ERP sync',
        description: 'Configure dynamic HTTP payload composition for ERP synchronization. Supports template-based request building with authentication, retries, and response mapping.',
      },
    }
  )

  /**
   * GET /api/v1/tenants/:tenantId/erp-sync
   * Get ERP sync configuration
   */
  .get(
    '/:tenantId/erp-sync',
    async ({ params, tenantService }) => {
      try {
        const config = await tenantService.getERPSyncConfig(params.tenantId);
        if (!config) {
          return {
            success: false,
            error: 'ERP sync not configured',
            statusCode: 404,
          };
        }
        return {
          success: true,
          data: config,
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
      params: tenantIdParamValidator,
      detail: {
        tags: ['Admin - ERP Integration', 'Tenant'],
        security: [{ adminKey: [] }],
        summary: 'Get ERP sync configuration',
        description: 'Retrieve the current ERP sync configuration with decrypted credentials',
      },
    }
  )

export default adminTenantRoutes;