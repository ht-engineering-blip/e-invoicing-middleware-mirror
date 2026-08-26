import { Elysia } from "elysia";
import crypto from "crypto";
import { appConfig } from "../../../@config";
import { logger, ResponseBuilder } from "../../../@lib";
import { MailContent, withTemplate } from "../../../@lib/messaging";
import { requireAuth, getActor } from "../../../middlewares/auth";
import { AuthService } from "../../auth/services";
import {
  onlyAdmin,
  onlySelf,
  onlyTenantAdmin,
} from "../../auth/utils/access-checks";
import { TenantService } from "../services/tenant.service";
import { templateEngine } from "../../../templates/engine";
import {
  createTenantValidation,
  listTenantsValidation,
  getTenantAnalyticsValidation,
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
  resendTenantTokenValidation,
  getKeyConfigValidation,
  updateKeyConfigValidation,
} from "../validations/admin.validation";
import {
  updateKeyMapValidation,
  updateReferenceKeyMapValidation,
} from "../validations/onboarding.validation";
import {
  KEY_CONFIG_REGISTRY,
  VALID_ERP_EVENT_TYPES,
  findKeyTypeDefinition,
  isValidErpEventType,
  resolveKeyConfig,
  parseMapToRecord,
  KeyTypeDefinition,
} from "../utils/key-config.helper";
import { INVOICE_EVENT_TYPES } from "../../admin/routes/reference.routes";

const VALID_EVENT_IDS = INVOICE_EVENT_TYPES.map((e) => e.id) as string[];

/**
 * Admin-protected tenant routes
 * All mutation operations require admin key
 */
/*   prefix: '/admin', */

const adminTenantRoutes = new Elysia({
  detail: {
    hide: appConfig?.env === "production",
  },
})
  .use(requireAuth)
  .decorate("tenantService", new TenantService())
  .decorate("authService", new AuthService())

  /**
   * POST /api/v1/tenants
   * Create a new tenant
   */
  .post(
    "/",
    async ({ auth, body, tenantService, authService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        const tenant = await tenantService.createTenant(body, getActor(auth));

        /* Notify Tenant to complete onboarding */
        const rawTenant = typeof tenant.toObject === "function" ? tenant.toObject() : tenant;
        let activationToken = await authService.createAuthToken(
          {
            ...rawTenant,
            activationTokenId: tenant.metadata?.activationTokenId,
          },
          "12HRS",
        );
        let activationLink = `${appConfig?.webAppURL}/auth/activate?_u=${activationToken}`;
        let activationEmail: MailContent = {
          subject: "Welcome to HT Invoicing",
          html: withTemplate(
            templateEngine.render("newTenants", { activationLink }),
          ),
        };
        await tenantService.notifyTenant(activationEmail, tenant);

        return ResponseBuilder.success(
          tenant,
          undefined,
          "Tenant created successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    createTenantValidation,
  )

  /**
   * GET /api/v1/tenants/analytics
   * Retrieve summary analytics counts for tenants
   */
  .get(
    "/analytics",
    async ({ auth, tenantService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        const analytics = await tenantService.getTenantAnalytics();
        return ResponseBuilder.success(
          analytics,
          undefined,
          "Tenant analytics retrieved successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    getTenantAnalyticsValidation,
  )

  /**
   * GET /api/v1/tenants
   * List all tenants with pagination and filtering
   */
  .get(
    "/",
    async ({ auth, query, tenantService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        const { page, limit, onboarding, status, search } = query;
        const pageNum = Number(page || 1);
        const limitNum = Number(limit || 20);
        const includeOnboarding =
          onboarding !== undefined ? Boolean(onboarding) : true;
        const skip = (pageNum - 1) * limitNum;

        const result = await tenantService.listTenants({
          status,
          search,
          skip,
          limit: limitNum,
          includeOnboarding,
        });

        return ResponseBuilder.paginate(
          result.tenants,
          result.total,
          pageNum,
          limitNum,
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    listTenantsValidation,
  )

  /**
   * GET /api/v1/tenants/:tenantId
   * Get tenant by ID
   */
  .get(
    "/:tenantId",
    async ({ auth, params, tenantService, set }) => {
      try {
        // Verify the user has access to this tenant
        onlySelf(auth!, params.tenantId);
        const tenant = await tenantService.getTenantById(params.tenantId, true);
        return ResponseBuilder.success(tenant);
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    getTenantByIdValidation,
  )

  /**
   * PATCH /api/v1/tenants/:tenantId
   * Update tenant information
   */
  .patch(
    "/:tenantId",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        // Verify access
        onlyTenantAdmin(auth!, params.tenantId);
        const tenant = await tenantService.updateTenant(
          params.tenantId,
          body,
          getActor(auth),
        );
        return ResponseBuilder.success(
          tenant,
          undefined,
          "Tenant updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    updateTenantValidation,
  )

  /**
   * POST /api/v1/tenants/:tenantId/activate
   * Activate a tenant
   */
  .post(
    "/:tenantId/activate",
    async ({ auth, params, tenantService, set }) => {
      try {
        // Verify access
        onlyAdmin(
          auth!,
          "Forbidden: You are not authorized to activate this tenant",
        );

        const tenant = await tenantService.activateTenant(
          params.tenantId,
          getActor(auth),
        );
        return ResponseBuilder.success(
          tenant,
          undefined,
          "Tenant activated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    activateTenantValidation,
  )

  /**
   * POST /api/v1/tenants/:tenantId/suspend
   * Suspend a tenant
   */
  .post(
    "/:tenantId/suspend",
    async ({ auth, params, tenantService, set }) => {
      try {
        // Verify access
        onlyAdmin(
          auth!,
          "Forbidden: You are not authorized to suspend this tenant",
        );

        const tenant = await tenantService.suspendTenant(
          params.tenantId,
          undefined,
          getActor(auth),
        );
        return ResponseBuilder.success(
          tenant,
          undefined,
          "Tenant suspended successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    suspendTenantValidation,
  )

  /**
   * DELETE /api/v1/tenants/:tenantId
   * Delete a tenant
   */
  .delete(
    "/:tenantId",
    async ({ auth, params, tenantService, set }) => {
      try {
        // Verify access
        onlyAdmin(
          auth!,
          "Forbidden: You are not authorized to delete this tenant",
        );

        await tenantService.deleteTenant(params.tenantId, getActor(auth));
        return ResponseBuilder.success(
          undefined,
          undefined,
          "Tenant deleted successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    deleteTenantValidation,
  )
  /**
   * PATCH /api/v1/tenants/:tenantId/onboarding
   * Update onboarding status
   */
  .patch(
    "/:tenantId/onboarding",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        const onboarding = await tenantService.updateOnboarding(
          params.tenantId,
          body,
          getActor(auth),
        );
        return ResponseBuilder.success(
          onboarding,
          undefined,
          "Onboarding status updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    updateOnboardingStatusValidation,
  )

  /* API Keys Endpoints */
  //adminTenantRoutes

  /**
   * POST /api/v1/tenants/:tenantId/api-keys
   * Create a new API key for a tenant
   */
  .post(
    "/:tenantId/api-keys",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const result = await tenantService.createApiKey(
          params.tenantId,
          body,
          getActor(auth),
        );
        return ResponseBuilder.success(
          {
            ...result.apiKey,
            key: result.plainKey, // Only returned once
          },
          undefined,
          "API key created successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    createApiKeyValidation,
  )

  /**
   * GET /api/v1/tenants/:tenantId/api-keys
   * List API keys for a tenant
   */
  .get(
    "/:tenantId/api-keys",
    async ({ auth, params, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const apiKeys = await tenantService.listApiKeys(params.tenantId);
        return ResponseBuilder.success(apiKeys);
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    listApiKeysValidation,
  )

  /**
   * DELETE /api/v1/tenants/:tenantId/api-keys/:keyId
   * Revoke an API key
   */
  .delete(
    "/:tenantId/api-keys/:keyId",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        console.log({ params });
        onlyTenantAdmin(auth!, params.tenantId);
        await tenantService.revokeApiKey(
          params.tenantId,
          params.keyId,
          body?.reason,
          getActor(auth),
        );
        return ResponseBuilder.success(
          undefined,
          undefined,
          "API key revoked successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    revokeApiKeyValidation,
  )

  /**
   * POST /api/v1/tenants/:tenantId/api-keys/:keyId/rotate
   * Rotate an API key (revoke old and create new)
   */
  .post(
    "/:tenantId/api-keys/:keyId/rotate",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const result = await tenantService.rotateApiKey(
          params.tenantId,
          params.keyId,
          {
            sendEmail: body?.sendEmail !== false,
            reason: body?.reason,
          },
          getActor(auth),
        );

        return ResponseBuilder.success(
          {
            ...result.apiKey,
            key: result.plainKey, // Only returned once
            emailSent: body?.sendEmail !== false,
          },
          undefined,
          "API key rotated successfully. New key sent via email.",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    rotateApiKeyValidation,
  )

  /**
   * GET /api/v1/tenants/api-keys
   * List all API keys across all tenants (Admin only)
   */
  .get(
    "/api-keys",
    async ({ auth, query, tenantService, set }) => {
      try {
        // Verify admin access
        onlyAdmin(auth!, "Forbidden: Admin access required");

        const page = Number(query.page || 1);
        const limit = Number(query.limit || 50);
        const skip = (page - 1) * limit;

        const result = await tenantService.listAllApiKeys({
          status: query.status,
          tenantId: query.tenantId,
          skip,
          limit,
        });

        return ResponseBuilder.paginate(
          result.apiKeys,
          result.total,
          page,
          limit,
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    listAllApiKeysValidation,
  )

  /* ERP Sync Configuration */
  //adminTenantRoutes
  /**
   * GET /api/v1/tenants/erp-configs
   * List all ERP configurations across all tenants (Admin only)
   */
  .get(
    "/erp-configs",
    async ({ auth, query, tenantService, set }) => {
      try {
        // Verify admin access
        onlyAdmin(auth!, "Forbidden: Admin access required");

        const page = Number(query.page || 1);
        const limit = Number(query.limit || 50);
        const skip = (page - 1) * limit;

        const result = await tenantService.listAllERPConfigs({
          erpSystem: query.erpSystem,
          enabled:
            query.enabled !== undefined ? query.enabled === "true" : undefined,
          skip,
          limit,
        });

        return ResponseBuilder.paginate(
          result.configs,
          result.total,
          page,
          limit,
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    listAllERPConfigsValidation,
  )

  /**
   * PUT /api/v1/tenants/:tenantId/erp-sync
   * Configure ERP sync settings for dynamic REST calls
   */
  .put(
    "/:tenantId/erp-sync",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const _updatedTenant = await tenantService.configureERPSync(
          params.tenantId,
          body,
          getActor(auth),
        );

        // Automatically update onboarding step - mark FIRS provisioning as complete
        try {
          const onboarding = await tenantService.getOnboardingStatus(
            params.tenantId,
          );
          if (onboarding && !onboarding.steps?.erpConfiguration?.completed) {
            await tenantService.completeOnboardingStep(
              params.tenantId,
              "erpConfiguration",
              getActor(auth),
            );

            // Update status to in_progress if still pending
            if (onboarding.status === "pending") {
              await tenantService.updateOnboarding(
                params.tenantId,
                {
                  status: "in_progress",
                },
                getActor(auth),
              );
            }
          }
        } catch (onboardingError) {
          // Don't fail the main operation if onboarding update fails
          logger.warn("Failed to update onboarding status:", onboardingError);
        }

        return ResponseBuilder.success(
          {
            tenantId: params.tenantId,
            configName: body.name,
            enabled: body.enabled,
          },
          undefined,
          "ERP sync configuration updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    configureERPSyncValidation,
  )

  /**
   * PUT /api/v1/tenants/:tenantId/id-key-map
   * Add or update an idKeyMap entry
   */
  .put(
    "/:tenantId/id-key-map",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        if (!isValidErpEventType(body.eventType)) {
          set.status = 400;
          return ResponseBuilder.error(
            `Unknown event '${body.eventType}'. Must be one of: ${VALID_ERP_EVENT_TYPES.join(", ")}`,
            400,
          );
        }

        const tenant = await tenantService.getTenantById(params.tenantId);
        if (!tenant) {
          set.status = 404;
          return ResponseBuilder.error("Tenant not found", 404);
        }
        const tenantObj = typeof tenant.toObject === "function" ? tenant.toObject() : tenant;

        const rawIdKeyMap =
          tenantObj.config?.idKeyMap instanceof Map
            ? Object.fromEntries(tenantObj.config.idKeyMap)
            : tenantObj.config?.idKeyMap || {};

        const idKeyMap = {
          ...rawIdKeyMap,
          [body.eventType.replace(/\./g, "_")]: body.idKey,
        };

        const updatedConfig = {
          ...tenantObj.config,
          idKeyMap,
        };

        await tenantService.updateTenant(
          params.tenantId,
          { config: updatedConfig } as any,
          getActor(auth),
        );

        return ResponseBuilder.success(
          {
            eventType: body.eventType,
            idKey: body.idKey,
          },
          undefined,
          "idKeyMap updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    updateKeyMapValidation,
  )

  /**
   * PUT /api/v1/tenants/:tenantId/reference-id-key-map
   * Add or update a referenceIdKeyMap entry
   */
  .put(
    "/:tenantId/reference-id-key-map",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        if (!isValidErpEventType(body.eventType)) {
          set.status = 400;
          return ResponseBuilder.error(
            `Unknown event '${body.eventType}'. Must be one of: ${VALID_ERP_EVENT_TYPES.join(", ")}`,
            400,
          );
        }

        const tenant = await tenantService.getTenantById(params.tenantId);
        if (!tenant) {
          set.status = 404;
          return ResponseBuilder.error("Tenant not found", 404);
        }
        const tenantObj = typeof tenant.toObject === "function" ? tenant.toObject() : tenant;

        const referenceIdKeyMap =
          tenantObj.config?.referenceIdKeyMap instanceof Map
            ? tenantObj.config.referenceIdKeyMap
            : new Map(
                Object.entries(tenantObj.config?.referenceIdKeyMap || {}),
              );

        referenceIdKeyMap.set(body.eventType.replace(/\./g, "_"), body.idKey);

        const updatedConfig = {
          ...tenantObj.config,
          referenceIdKeyMap,
        };

        await tenantService.updateTenant(
          params.tenantId,
          { config: updatedConfig } as any,
          getActor(auth),
        );

        return ResponseBuilder.success(
          {
            eventType: body.eventType,
            idKey: body.idKey,
          },
          undefined,
          "referenceIdKeyMap updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    updateReferenceKeyMapValidation,
  )

  /**
   * GET /api/v1/tenants/:tenantId/key-config
   * Get invoiceIdKey, idKeyMap, and referenceIdKeyMap configuration with dynamic keyType filtering
   */
  .get(
    "/:tenantId/key-config",
    async ({ auth, params, query, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        const tenant = await tenantService.getTenantById(params.tenantId);

        if (!tenant) {
          set.status = 404;
          return ResponseBuilder.error("Tenant not found", 404);
        }

        const requestedKeyType = query?.keyType?.toLowerCase()?.trim();

        if (requestedKeyType && requestedKeyType !== "all") {
          const matchedDef = findKeyTypeDefinition(requestedKeyType);

          if (!matchedDef) {
            set.status = 400;
            return ResponseBuilder.error(
              `Invalid keyType '${requestedKeyType}'. Must be one of: ${KEY_CONFIG_REGISTRY.map((d) => d.keyType).join(", ")}`,
              400,
            );
          }

          return ResponseBuilder.success(
            resolveKeyConfig(matchedDef, tenant.config),
          );
        }

        // Return all registered key groups dynamically
        const keyGroups: Record<string, any> = {};
        for (const def of KEY_CONFIG_REGISTRY) {
          keyGroups[def.keyType] = resolveKeyConfig(def, tenant.config);
        }

        const rawIdKeyMap = parseMapToRecord(tenant.config?.idKeyMap);
        const rawRefIdKeyMap = parseMapToRecord(
          tenant.config?.referenceIdKeyMap,
        );

        const standardKey = (tenant.config?.invoiceIdKey ||
          keyGroups["standard_invoice"]?.idKey ||
          "invoiceId") as string;

        return ResponseBuilder.success({
          ...keyGroups,
          invoiceIdKey: standardKey,
          idKeyMap: Object.fromEntries(
            Object.entries(rawIdKeyMap).map(([k, v]) => [
              k.replace(/_/g, "."),
              v,
            ]),
          ),
          referenceIdKeyMap: Object.fromEntries(
            Object.entries(rawRefIdKeyMap).map(([k, v]) => [
              k.replace(/_/g, "."),
              v,
            ]),
          ),
        });
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    getKeyConfigValidation,
  )

  /**
   * PUT /api/v1/tenants/:tenantId/key-config
   * Update ID key mapping by keyType (standard_invoice, credit_note, debit_note, payment) or explicit eventType
   */
  .put(
    "/:tenantId/key-config",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        const tenant = await tenantService.getTenantById(params.tenantId);
        if (!tenant) {
          set.status = 404;
          return ResponseBuilder.error("Tenant not found", 404);
        }
        const tenantObj = typeof tenant.toObject === "function" ? tenant.toObject() : tenant;

        const idKeyMap = { ...parseMapToRecord(tenantObj.config?.idKeyMap) };
        const referenceIdKeyMap = {
          ...parseMapToRecord(tenantObj.config?.referenceIdKeyMap),
        };
        let invoiceIdKey = (tenantObj.config?.invoiceIdKey ||
          "invoiceId") as string;

        const matchedDef = findKeyTypeDefinition(body.keyType);

        if (matchedDef) {
          for (const key of matchedDef.eventKeys) {
            idKeyMap[key.replace(/\./g, "_")] = body.idKey;
          }

          if (matchedDef.keyType === "standard_invoice") {
            invoiceIdKey = body.idKey;
          }

          if (body.referenceIdKey && matchedDef.hasReferenceKey) {
            for (const key of matchedDef.eventKeys) {
              referenceIdKeyMap[key.replace(/\./g, "_")] = body.referenceIdKey;
            }
          }
        } else if (body.eventType && isValidErpEventType(body.eventType)) {
          const safeKey = body.eventType.replace(/\./g, "_");
          idKeyMap[safeKey] = body.idKey;
          if (body.referenceIdKey) {
            referenceIdKeyMap[safeKey] = body.referenceIdKey;
          }
        } else {
          set.status = 400;
          return ResponseBuilder.error(
            `Invalid keyType or eventType. Must be one of: ${VALID_ERP_EVENT_TYPES.join(", ")}`,
            400,
          );
        }

        const updatedConfig = {
          ...tenantObj.config,
          invoiceIdKey,
          idKeyMap,
          referenceIdKeyMap,
        };

        await tenantService.updateTenant(
          params.tenantId,
          { config: updatedConfig } as any,
          getActor(auth),
        );

        return ResponseBuilder.success(
          {
            keyType: matchedDef?.keyType || body.keyType,
            eventType: matchedDef?.eventType || body.eventType,
            idKey: body.idKey,
            referenceIdKey: body.referenceIdKey,
            invoiceIdKey,
          },
          undefined,
          "Key configuration updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    updateKeyConfigValidation,
  )

  /**
   * GET /api/v1/tenants/:tenantId/erp-sync
   * Get ERP sync configuration
   */
  .get(
    "/:tenantId/erp-sync",
    async ({ auth, params, query, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const config = await tenantService.getERPSyncConfig(params.tenantId);
        if (!config) {
          set.status = 404;
          return ResponseBuilder.error("ERP sync not configured", 404);
        }
        const sanitizedConfig = { ...config };
        if (sanitizedConfig.authentication) {
          sanitizedConfig.authentication = {
            ...sanitizedConfig.authentication,
          };
          const shouldDecrypt =
            auth?.isAdmin &&
            (query?.decrypt === undefined || query?.decrypt === "true");

          if (!shouldDecrypt) {
            if (sanitizedConfig.authentication.password) {
              sanitizedConfig.authentication.password = "[REDACTED]";
            }
            if (sanitizedConfig.authentication.token) {
              sanitizedConfig.authentication.token = "[REDACTED]";
            }
            if (sanitizedConfig.authentication.apiKeyValue) {
              sanitizedConfig.authentication.apiKeyValue = "[REDACTED]";
            }
          }
        }

        return ResponseBuilder.success(sanitizedConfig);
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    getERPSyncConfigValidation,
  )

  /**
   * POST /api/v1/tenants/:tenantId/resend-token
   * Resend activation token for a tenant (Admin only)
   */
  .post(
    "/:tenantId/resend-token",
    async ({ params, auth, tenantService, authService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");

        logger.info("Admin resending activation email", {
          tenantId: params.tenantId,
        });

        const tenant = await tenantService.getTenantById(params.tenantId);
        if (!tenant) {
          set.status = 404;
          return ResponseBuilder.error("Tenant not found", 404);
        }
        const tenantObj = typeof tenant.toObject === "function" ? tenant.toObject() : tenant;

        // Check if already activated
        if (tenantObj.password || tenantObj.metadata?.activationCompleted) {
          set.status = 400;
          return ResponseBuilder.error(
            "Account has already been activated",
            400,
          );
        }

        // Check if previous token is still in timeframe and disable/invalidate it using service helper
        if (tenantService.isActivationTokenInTimeframe(tenant)) {
          logger.info("Admin disabling previous activation token", {
            tenantId: tenantObj.tenantId,
            tokenId: tenantObj.metadata?.activationTokenId,
          });
          // Overwritten by new values in the update below
        }

        // Generate new activation token and timeframe
        const activationTokenId = crypto.randomUUID();
        const activationTokenExpiresAt = new Date(
          Date.now() + 12 * 60 * 60 * 1000,
        ); // 12 hours

        const metadata = {
          ...tenantObj.metadata,
          activationTokenId,
          activationTokenExpiresAt,
        };

        await tenantService.updateTenant(
          tenantObj.tenantId,
          { metadata },
          getActor(auth),
        );

        // Resend activation email with new token ID
        let activationToken = await authService.createAuthToken(
          {
            ...tenantObj,
            activationTokenId,
          } as any,
          "12HRS",
        );

        let activationLink = `${appConfig?.webAppURL}/auth/activate?_u=${activationToken}`;
        let activationEmail: MailContent = {
          subject: "Welcome to HT Invoicing",
          html: withTemplate(
            templateEngine.render("newTenants", { activationLink }),
          ),
        };
        await tenantService.notifyTenant(activationEmail, tenant);

        return ResponseBuilder.success(
          undefined,
          undefined,
          "Activation email resent successfully by admin",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Admin failed to resend activation email", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to resend activation email",
          error.statusCode || 500,
        );
      }
    },
    resendTenantTokenValidation,
  );

export default adminTenantRoutes;
