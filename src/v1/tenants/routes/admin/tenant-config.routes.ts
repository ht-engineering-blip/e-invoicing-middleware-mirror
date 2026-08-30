import { Elysia } from "elysia";
import { logger, ResponseBuilder } from "../../../../@lib";
import { requireAuth, getActor } from "../../../../middlewares/auth";
import { onlyAdmin, onlyTenantAdmin } from "../../../auth/utils/access-checks";
import { TenantService } from "../../services/tenant.service";
import {
  listAllERPConfigsValidation,
  configureERPSyncValidation,
  getERPSyncConfigValidation,
  getKeyConfigValidation,
  updateKeyConfigValidation,
  updateOnboardingStatusValidation,
} from "../../validations/admin.validation";
import {
  updateKeyMapValidation,
  updateReferenceKeyMapValidation,
} from "../../validations/onboarding.validation";
import {
  findKeyTypeDefinition,
  resolveKeyConfig,
  parseMapToRecord,
  KEY_CONFIG_REGISTRY,
} from "../../utils/key-config.helper";
import { INVOICE_EVENT_TYPES } from "../../../admin/routes/reference.routes";

const VALID_EVENT_IDS = INVOICE_EVENT_TYPES.map((e) => e.id) as string[];

function redactERPCredentials(config: any): any {
  if (!config) return config;
  const cloned = JSON.parse(JSON.stringify(config));
  if (cloned.authentication) {
    if (cloned.authentication.password)
      cloned.authentication.password = "[REDACTED]";
    if (cloned.authentication.token) cloned.authentication.token = "[REDACTED]";
    if (cloned.authentication.apiKeyValue)
      cloned.authentication.apiKeyValue = "[REDACTED]";
    if (cloned.authentication.secret)
      cloned.authentication.secret = "[REDACTED]";
  }
  return cloned;
}

export const adminTenantConfigRoutes = new Elysia()
  .use(requireAuth)
  .decorate("tenantService", new TenantService())

  /**
   * GET /api/v1/tenants/configs/erp-sync/all
   * List all ERP sync configurations across all tenants (admin only)
   */
  .get(
    "/configs/erp-sync/all",
    async ({ auth, query, tenantService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        const page = Math.max(1, parseInt(String(query?.page || 1), 10));
        const limit = Math.min(
          100,
          Math.max(1, parseInt(String(query?.limit || 20), 10)),
        );
        const result = await tenantService.listAllERPConfigs(query as any);
        return ResponseBuilder.paginate(
          result.configs,
          result.total,
          page,
          limit,
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error listing all ERP sync configs", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to list ERP sync configs",
          error.statusCode || 500,
        );
      }
    },
    listAllERPConfigsValidation,
  )

  /**
   * POST /api/v1/tenants/:tenantId/erp-sync
   * Configure ERP sync for a tenant
   */
  .post(
    "/:tenantId/erp-sync",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const result = await tenantService.configureERPSync(
          params.tenantId,
          body,
          getActor(auth),
        );
        return ResponseBuilder.success(
          result,
          undefined,
          "ERP sync configured successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error configuring ERP sync", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to configure ERP sync",
          error.statusCode || 500,
        );
      }
    },
    configureERPSyncValidation,
  )

  /**
   * PUT /api/v1/tenants/:tenantId/erp-sync
   * Update/Configure ERP sync for a tenant
   */
  .put(
    "/:tenantId/erp-sync",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const result = await tenantService.configureERPSync(
          params.tenantId,
          body,
          getActor(auth),
        );
        return ResponseBuilder.success(
          result,
          undefined,
          "ERP sync configured successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error configuring ERP sync", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to configure ERP sync",
          error.statusCode || 500,
        );
      }
    },
    configureERPSyncValidation,
  )

  /**
   * GET /api/v1/tenants/:tenantId/erp-sync
   * Get ERP sync config for a tenant
   */
  .get(
    "/:tenantId/erp-sync",
    async ({ auth, params, query, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const config = await tenantService.getERPSyncConfig(params.tenantId);

        const isGlobalAdmin =
          (auth as any)?.type === "admin" ||
          (auth as any)?.isAdmin === true ||
          (auth as any)?.role === "super_admin";

        const allowDecrypt =
          isGlobalAdmin && (query as any)?.decrypt !== "false";

        const responseConfig = allowDecrypt
          ? config
          : redactERPCredentials(config);

        return ResponseBuilder.success(
          responseConfig,
          undefined,
          "ERP sync config retrieved successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error fetching ERP sync config", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to fetch ERP sync config",
          error.statusCode || 500,
        );
      }
    },
    getERPSyncConfigValidation,
  )

  /**
   * GET /api/v1/tenants/:tenantId/key-config
   * Get dynamic key-path configuration for a tenant
   */
  .get(
    "/:tenantId/key-config",
    async ({ auth, params, query, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const tenant = await tenantService.getTenantById(params.tenantId);

        const keyTypeParam = query?.keyType;
        if (keyTypeParam) {
          const def = findKeyTypeDefinition(keyTypeParam);
          if (!def) {
            set.status = 400;
            return ResponseBuilder.error(
              `Unknown keyType "${keyTypeParam}".`,
              400,
            );
          }
          const result = resolveKeyConfig(def, tenant.config);
          return ResponseBuilder.success(
            result,
            undefined,
            `Key config for "${keyTypeParam}" retrieved successfully`,
          );
        }

        const groups: Record<string, any> = {};
        for (const def of KEY_CONFIG_REGISTRY) {
          groups[def.keyType] = resolveKeyConfig(def, tenant.config);
        }
        groups.invoiceIdKey = groups.standard_invoice?.idKey || "invoiceId";

        return ResponseBuilder.success(
          groups,
          undefined,
          "All key configs retrieved successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error retrieving key config", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to retrieve key config",
          error.statusCode || 500,
        );
      }
    },
    getKeyConfigValidation,
  )

  /**
   * PUT /api/v1/tenants/:tenantId/key-config
   * Update key configurations
   */
  .put(
    "/:tenantId/key-config",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        const { keyType, eventType, idKey, referenceIdKey } = body as any;
        const tenant = await tenantService.getTenantById(params.tenantId);
        const existingConfig = (tenant.config as any) || {};
        const idKeyMap = parseMapToRecord(existingConfig.idKeyMap);
        const referenceIdKeyMap = parseMapToRecord(
          existingConfig.referenceIdKeyMap,
        );

        const def = findKeyTypeDefinition(
          keyType || eventType || "standard_invoice",
        );
        const resolvedEventType =
          eventType || def?.eventType || "erp.invoice.submitted";

        if (idKey) {
          idKeyMap[resolvedEventType] = idKey;
          idKeyMap[resolvedEventType.replace(/\./g, "_")] = idKey;
          if (def?.keyType) {
            idKeyMap[def.keyType] = idKey;
          }
          if (def?.eventKeys) {
            for (const k of def.eventKeys) {
              idKeyMap[k] = idKey;
              idKeyMap[k.replace(/\./g, "_")] = idKey;
            }
          }
        }

        if (referenceIdKey) {
          referenceIdKeyMap[resolvedEventType] = referenceIdKey;
          referenceIdKeyMap[resolvedEventType.replace(/\./g, "_")] =
            referenceIdKey;
          if (def?.keyType) {
            referenceIdKeyMap[def.keyType] = referenceIdKey;
          }
          if (def?.eventKeys) {
            for (const k of def.eventKeys) {
              referenceIdKeyMap[k] = referenceIdKey;
              referenceIdKeyMap[k.replace(/\./g, "_")] = referenceIdKey;
            }
          }
        }

        const updatePayload: any = {
          idKeyMap,
          referenceIdKeyMap,
        };
        if (def?.keyType === "standard_invoice" && idKey) {
          updatePayload.invoiceIdKey = idKey;
        }

        const updatedTenant = await tenantService.updateTenant(
          params.tenantId,
          { config: updatePayload },
          getActor(auth),
        );

        const mergedConfig = {
          ...(updatedTenant?.config || existingConfig),
          idKeyMap,
          referenceIdKeyMap,
          ...(updatePayload.invoiceIdKey
            ? { invoiceIdKey: updatePayload.invoiceIdKey }
            : {}),
        };

        const result = def
          ? resolveKeyConfig(def, mergedConfig)
          : { idKey, referenceIdKey };

        return ResponseBuilder.success(
          result,
          undefined,
          `Key config for "${keyType || "standard"}" updated successfully`,
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error updating key config", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to update key config",
          error.statusCode || 500,
        );
      }
    },
    updateKeyConfigValidation,
  )

  /**
   * PUT /api/v1/tenants/:tenantId/key-map
   * Legacy endpoint: updates idKeyMap
   */
  .put(
    "/:tenantId/key-map",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        const idKeyMap = (body as any)?.idKeyMap ?? body;
        if (!idKeyMap || typeof idKeyMap !== "object") {
          set.status = 400;
          return ResponseBuilder.error(
            "Invalid request: idKeyMap object is required",
            400,
          );
        }

        const invalidKeys = Object.keys(idKeyMap).filter(
          (k) => !VALID_EVENT_IDS.includes(k),
        );
        if (invalidKeys.length > 0) {
          set.status = 400;
          return ResponseBuilder.error(
            `Invalid event type(s): ${invalidKeys.join(", ")}. Valid event types: ${VALID_EVENT_IDS.join(", ")}`,
            400,
          );
        }

        const tenant = await tenantService.getTenantById(params.tenantId);
        const existingConfig = (tenant.config as any) || {};
        const existingMap = parseMapToRecord(existingConfig.idKeyMap);
        const mergedMap = { ...existingMap, ...idKeyMap };

        const updatedTenant = await tenantService.updateTenant(
          params.tenantId,
          {
            config: {
              ...existingConfig,
              idKeyMap: mergedMap,
            },
          },
          getActor(auth),
        );

        return ResponseBuilder.success(
          {
            tenantId: updatedTenant.tenantId,
            idKeyMap: (updatedTenant.config as any)?.idKeyMap,
          },
          undefined,
          "Key map updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error updating key map", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to update key map",
          error.statusCode || 500,
        );
      }
    },
    updateKeyMapValidation,
  )

  /**
   * PUT /api/v1/tenants/:tenantId/reference-key-map
   * Legacy endpoint: updates referenceIdKeyMap
   */
  .put(
    "/:tenantId/reference-key-map",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        const referenceIdKeyMap = (body as any)?.referenceIdKeyMap ?? body;
        if (!referenceIdKeyMap || typeof referenceIdKeyMap !== "object") {
          set.status = 400;
          return ResponseBuilder.error(
            "Invalid request: referenceIdKeyMap object is required",
            400,
          );
        }

        const invalidKeys = Object.keys(referenceIdKeyMap).filter(
          (k) => !VALID_EVENT_IDS.includes(k),
        );
        if (invalidKeys.length > 0) {
          set.status = 400;
          return ResponseBuilder.error(
            `Invalid event type(s): ${invalidKeys.join(", ")}. Valid event types: ${VALID_EVENT_IDS.join(", ")}`,
            400,
          );
        }

        const tenant = await tenantService.getTenantById(params.tenantId);
        const existingConfig = (tenant.config as any) || {};
        const existingMap = parseMapToRecord(existingConfig.referenceIdKeyMap);
        const mergedMap = { ...existingMap, ...referenceIdKeyMap };

        const updatedTenant = await tenantService.updateTenant(
          params.tenantId,
          {
            config: {
              ...existingConfig,
              referenceIdKeyMap: mergedMap,
            },
          },
          getActor(auth),
        );

        return ResponseBuilder.success(
          {
            tenantId: updatedTenant.tenantId,
            referenceIdKeyMap: (updatedTenant.config as any)?.referenceIdKeyMap,
          },
          undefined,
          "Reference key map updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error updating reference key map", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to update reference key map",
          error.statusCode || 500,
        );
      }
    },
    updateReferenceKeyMapValidation,
  )

  /**
   * PUT & PATCH /api/v1/tenants/:tenantId/onboarding
   * Update tenant onboarding status (admin only)
   */
  .put(
    "/:tenantId/onboarding/status",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        const tenant = await tenantService.updateOnboarding(
          params.tenantId,
          body as any,
          getActor(auth),
        );
        return ResponseBuilder.success(
          tenant,
          undefined,
          "Onboarding status updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error updating onboarding status", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to update onboarding status",
          error.statusCode || 500,
        );
      }
    },
    updateOnboardingStatusValidation,
  )
  .patch(
    "/:tenantId/onboarding",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        const tenant = await tenantService.updateOnboarding(
          params.tenantId,
          body as any,
          getActor(auth),
        );
        return ResponseBuilder.success(
          tenant,
          undefined,
          "Onboarding updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error updating onboarding", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to update onboarding",
          error.statusCode || 500,
        );
      }
    },
  );
