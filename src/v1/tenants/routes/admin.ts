import { Elysia } from 'elysia';
import crypto from 'crypto';
import { appConfig } from '../../../@config';
import { logger } from '../../../@lib';
import { MailContent, withTemplate } from '../../../@lib/messaging';
import { requireAuth, getActor } from '../../../middlewares/auth';
import { AuthService } from '../../auth/services';
import { onlyAdmin, onlySelf, onlyTenantAdmin } from '../../auth/utils/access-checks';
import { TenantService } from '../services/tenant.service';
import { templateEngine } from '../../../templates/engine';
import {
  createTenantValidation,
  listTenantsValidation,
  getTenantByIdValidation,
  updateTenantValidation,
  activateTenantValidation,
  suspendTenantValidation,
  deleteTenantValidation,
  updateOnboardingStatusValidation,
  createApiKeyValidation,
  listApiKeysValidation,
  revokeApiKeyValidation,
  rotateApiKeyValidation,
  listAllApiKeysValidation,
  listAllERPConfigsValidation,
  configureERPSyncValidation,
  getERPSyncConfigValidation,
  resendTenantTokenValidation
} from '../validations/admin.validation';
import { updateKeyMapValidation } from '../validations/onboarding.validation';
import { INVOICE_EVENT_TYPES } from '../../admin/routes/reference.routes';

const VALID_EVENT_IDS = INVOICE_EVENT_TYPES.map((e) => e.id) as string[];

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
    async ({ auth, body, tenantService, authService, set }) => {
      try {
        onlyAdmin(auth!, 'Forbidden: Admin access required');
        const tenant = await tenantService.createTenant(body, getActor(auth));

        /* Notify Tenant to complete onboarding */
        let activationToken = await authService.createAuthToken({
          ...tenant.toObject(),
          activationTokenId: tenant.metadata?.activationTokenId,
        }, "12HRS")
        let activationLink = `${appConfig?.webAppURL}/auth/activate?_u=${activationToken}`;
        let activationEmail: MailContent = {
          subject: 'Welcome to HT Invoicing',
          html: withTemplate(templateEngine.render('newTenants', { activationLink })),
        }
        await tenantService.notifyTenant(activationEmail, tenant)

        return {
          success: true,
          message: 'Tenant created successfully',
          data: tenant,
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
    createTenantValidation
  )

  /**
   * GET /api/v1/tenants
   * List all tenants with pagination and filtering
   */
  .get(
    '/',
    async ({ auth, query, tenantService }) => {
      try {
        onlyAdmin(auth!, 'Forbidden: Admin access required');
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
    listTenantsValidation
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
    getTenantByIdValidation
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
        onlyTenantAdmin(auth!, params.tenantId);
        const tenant = await tenantService.updateTenant(params.tenantId, body, getActor(auth));
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
    updateTenantValidation
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


        const tenant = await tenantService.activateTenant(params.tenantId, getActor(auth));
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
    activateTenantValidation
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

        const tenant = await tenantService.suspendTenant(params.tenantId, undefined, getActor(auth));
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
    suspendTenantValidation
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

        await tenantService.deleteTenant(params.tenantId, getActor(auth));
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
    deleteTenantValidation
  )
  /**
   * PATCH /api/v1/tenants/:tenantId/onboarding
   * Update onboarding status
   */
  .patch(
    '/:tenantId/onboarding',
    async ({ auth, params, body, tenantService }) => {
      try {
        onlyAdmin(auth!, 'Forbidden: Admin access required');
        const onboarding = await tenantService.updateOnboarding(params.tenantId, body, getActor(auth));
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
    updateOnboardingStatusValidation
  )


  /* API Keys Endpoints */
  //adminTenantRoutes

  /**
   * POST /api/v1/tenants/:tenantId/api-keys
   * Create a new API key for a tenant
   */
  .post(
    '/:tenantId/api-keys',
    async ({ auth, params, body, tenantService }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId)
        const result = await tenantService.createApiKey(params.tenantId, body, getActor(auth));
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
    createApiKeyValidation
  )

  /**
  * GET /api/v1/tenants/:tenantId/api-keys
  * List API keys for a tenant
  */
  .get(
    '/:tenantId/api-keys',
    async ({ auth, params, tenantService }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId)
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
    listApiKeysValidation
  )

  /**
   * DELETE /api/v1/tenants/:tenantId/api-keys/:keyId
   * Revoke an API key
   */
  .delete(
    '/:tenantId/api-keys/:keyId',
    async ({ auth, params, body, tenantService }) => {
      try {
        console.log({ params })
        onlyTenantAdmin(auth!, params.tenantId)
        await tenantService.revokeApiKey(params.tenantId, params.keyId, body?.reason, getActor(auth));
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
    revokeApiKeyValidation
  )

  /**
   * POST /api/v1/tenants/:tenantId/api-keys/:keyId/rotate
   * Rotate an API key (revoke old and create new)
   */
  .post(
    '/:tenantId/api-keys/:keyId/rotate',
    async ({ auth, params, body, tenantService }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId)
        const result = await tenantService.rotateApiKey(params.tenantId, params.keyId, {
          sendEmail: body?.sendEmail !== false,
          reason: body?.reason,
        }, getActor(auth));

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
    rotateApiKeyValidation
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
    listAllApiKeysValidation
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
    listAllERPConfigsValidation
  )

  /**
    * PUT /api/v1/tenants/:tenantId/erp-sync
    * Configure ERP sync settings for dynamic REST calls
    */
  .put(
    '/:tenantId/erp-sync',
    async ({ auth, params, body, tenantService }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const _updatedTenant = await tenantService.configureERPSync(params.tenantId, body, getActor(auth));

        // Automatically update onboarding step - mark FIRS provisioning as complete
        try {
          const onboarding = await tenantService.getOnboardingStatus(params.tenantId);
          if (onboarding && !onboarding.steps?.erpConfiguration?.completed) {
            await tenantService.completeOnboardingStep(params.tenantId, 'erpConfiguration', getActor(auth));

            // Update status to in_progress if still pending
            if (onboarding.status === 'pending') {
              await tenantService.updateOnboarding(params.tenantId, {
                status: 'in_progress',
              }, getActor(auth));
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
    configureERPSyncValidation
  )

  /**
   * PUT /api/v1/tenants/:tenantId/id-key-map
   * Add or update an idKeyMap entry
   */
  .put(
    '/:tenantId/id-key-map',
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        if (!VALID_EVENT_IDS.includes(body.eventType)) {
          set.status = 400;
          return { success: false, error: `Unknown event '${body.eventType}'.` };
        }

        const tenant = await tenantService.getTenantById(params.tenantId, true);
        if (!tenant) {
          set.status = 404;
          return { success: false, error: 'Tenant not found' };
        }

        const idKeyMap = tenant.config?.idKeyMap instanceof Map 
          ? tenant.config.idKeyMap 
          : new Map(Object.entries(tenant.config?.idKeyMap || {}));
        
        idKeyMap.set(body.eventType, body.idKey);

        const updatedConfig = {
          ...tenant.config,
          idKeyMap,
        };

        await tenantService.updateTenant(params.tenantId, { config: updatedConfig } as any, getActor(auth));

        return {
          success: true,
          message: 'idKeyMap updated successfully',
          data: {
            eventType: body.eventType,
            idKey: body.idKey,
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
    updateKeyMapValidation
  )

  /**
   * PUT /api/v1/tenants/:tenantId/reference-id-key-map
   * Add or update a referenceIdKeyMap entry
   */
  .put(
    '/:tenantId/reference-id-key-map',
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        if (!VALID_EVENT_IDS.includes(body.eventType)) {
          set.status = 400;
          return { success: false, error: `Unknown event '${body.eventType}'.` };
        }

        const tenant = await tenantService.getTenantById(params.tenantId, true);
        if (!tenant) {
          set.status = 404;
          return { success: false, error: 'Tenant not found' };
        }

        const referenceIdKeyMap = tenant.config?.referenceIdKeyMap instanceof Map 
          ? tenant.config.referenceIdKeyMap 
          : new Map(Object.entries(tenant.config?.referenceIdKeyMap || {}));
        
        referenceIdKeyMap.set(body.eventType, body.idKey);

        const updatedConfig = {
          ...tenant.config,
          referenceIdKeyMap,
        };

        await tenantService.updateTenant(params.tenantId, { config: updatedConfig } as any, getActor(auth));

        return {
          success: true,
          message: 'referenceIdKeyMap updated successfully',
          data: {
            eventType: body.eventType,
            idKey: body.idKey,
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
    updateKeyMapValidation
  )

  /**
   * GET /api/v1/tenants/:tenantId/erp-sync
   * Get ERP sync configuration
   */
  .get(
    '/:tenantId/erp-sync',
    async ({ auth, params, query, tenantService }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const config = await tenantService.getERPSyncConfig(params.tenantId);
        if (!config) {
          return {
            success: false,
            error: 'ERP sync not configured',
            statusCode: 404,
          };
        }
        const sanitizedConfig = { ...config };
        if (sanitizedConfig.authentication) {
          sanitizedConfig.authentication = { ...sanitizedConfig.authentication };
          const shouldDecrypt = auth?.isAdmin && (query?.decrypt === undefined || query?.decrypt === 'true');

          if (!shouldDecrypt) {
            if (sanitizedConfig.authentication.password) {
              sanitizedConfig.authentication.password = '[REDACTED]';
            }
            if (sanitizedConfig.authentication.token) {
              sanitizedConfig.authentication.token = '[REDACTED]';
            }
            if (sanitizedConfig.authentication.apiKeyValue) {
              sanitizedConfig.authentication.apiKeyValue = '[REDACTED]';
            }
          }
        }

        return {
          success: true,
          data: sanitizedConfig,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    getERPSyncConfigValidation
  )

  /**
   * POST /api/v1/tenants/:tenantId/resend-token
   * Resend activation token for a tenant (Admin only)
   */
  .post(
    '/:tenantId/resend-token',
    async ({ params, auth, tenantService, authService, set }) => {
      try {
        onlyAdmin(auth!, 'Forbidden: Admin access required');

        logger.info('Admin resending activation email', { tenantId: params.tenantId });

        const tenant = await tenantService.getTenantById(params.tenantId);
        if (!tenant) {
          set.status = 404;
          return {
            success: false,
            error: 'Tenant not found',
            statusCode: 404,
          };
        }

        // Check if already activated
        if (tenant.password || tenant.metadata?.activationCompleted) {
          set.status = 400;
          return {
            success: false,
            error: 'Account has already been activated',
            statusCode: 400,
          };
        }

        // Check if previous token is still in timeframe and disable/invalidate it using service helper
        if (tenantService.isActivationTokenInTimeframe(tenant)) {
          logger.info('Admin disabling previous activation token', {
            tenantId: tenant.tenantId,
            tokenId: tenant.metadata?.activationTokenId,
          });
          // Overwritten by new values in the update below
        }

        // Generate new activation token and timeframe
        const activationTokenId = crypto.randomUUID();
        const activationTokenExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours

        const metadata = {
          ...tenant.metadata,
          activationTokenId,
          activationTokenExpiresAt,
        };

        await tenantService.updateTenant(tenant.tenantId, { metadata }, getActor(auth));

        // Resend activation email with new token ID
        let activationToken = await authService.createAuthToken({
          ...tenant.toObject(),
          activationTokenId,
        } as any, "12HRS")

        let activationLink = `${appConfig?.webAppURL}/auth/activate?_u=${activationToken}`;
        let activationEmail: MailContent = {
          subject: 'Welcome to HT Invoicing',
          html: withTemplate(templateEngine.render('newTenants', { activationLink })),
        }
        await tenantService.notifyTenant(activationEmail, tenant)

        return {
          success: true,
          message: 'Activation email resent successfully by admin',
        };
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error('Admin failed to resend activation email', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to resend activation email',
          statusCode: error.statusCode || 500,
        };
      }
    },
    resendTenantTokenValidation
  )

export default adminTenantRoutes;