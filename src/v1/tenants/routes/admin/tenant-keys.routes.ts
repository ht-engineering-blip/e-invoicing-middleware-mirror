import { Elysia } from "elysia";
import { logger, ResponseBuilder } from "../../../../@lib";
import { requireAuth, getActor } from "../../../../middlewares/auth";
import { onlyAdmin, onlyTenantAdmin } from "../../../auth/utils/access-checks";
import { TenantService } from "../../services/tenant.service";
import {
  createApiKeyValidation,
  listApiKeysValidation,
  revokeApiKeyValidation,
  rotateApiKeyValidation,
  listAllApiKeysValidation,
} from "../../validations/admin.validation";

export const adminTenantKeysRoutes = new Elysia()
  .use(requireAuth)
  .decorate("tenantService", new TenantService())

  /**
   * POST /api/v1/tenants/:tenantId/api-keys
   * Create an API key for a tenant
   */
  .post(
    "/:tenantId/api-keys",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const apiKey = await tenantService.createApiKey(
          params.tenantId,
          body,
          getActor(auth),
        );
        return ResponseBuilder.success(
          apiKey,
          undefined,
          "API key created successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error creating API key", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to create API key",
          error.statusCode || 500,
        );
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
        const keys = await tenantService.listApiKeys(params.tenantId);
        return ResponseBuilder.success(
          keys,
          undefined,
          "API keys retrieved successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error listing API keys", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to list API keys",
          error.statusCode || 500,
        );
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
        onlyTenantAdmin(auth!, params.tenantId);
        await tenantService.revokeApiKey(
          params.tenantId,
          params.keyId,
          (body as any)?.reason,
          getActor(auth),
        );
        return ResponseBuilder.success(
          null,
          undefined,
          "API key revoked successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error revoking API key", {
          tenantId: params.tenantId,
          keyId: params.keyId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to revoke API key",
          error.statusCode || 500,
        );
      }
    },
    revokeApiKeyValidation,
  )

  /**
   * POST /api/v1/tenants/:tenantId/api-keys/:keyId/rotate
   * Rotate an API key
   */
  .post(
    "/:tenantId/api-keys/:keyId/rotate",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);
        const apiKey = await tenantService.rotateApiKey(
          params.tenantId,
          params.keyId,
          body as any,
          getActor(auth),
        );
        return ResponseBuilder.success(
          apiKey,
          undefined,
          "API key rotated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error rotating API key", {
          tenantId: params.tenantId,
          keyId: params.keyId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to rotate API key",
          error.statusCode || 500,
        );
      }
    },
    rotateApiKeyValidation,
  )

  /**
   * GET /api/v1/tenants/api-keys/all
   * List all API keys across all tenants (admin only)
   */
  .get(
    "/api-keys/all",
    async ({ auth, query, tenantService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        const page = Math.max(1, parseInt(String(query?.page || "1"), 10));
        const limit = Math.min(100, Math.max(1, parseInt(String(query?.limit || "20"), 10)));
        const result = await tenantService.listAllApiKeys(query as any);
        return ResponseBuilder.paginate(
          result.apiKeys,
          result.total,
          page,
          limit,
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error listing all API keys", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to list all API keys",
          error.statusCode || 500,
        );
      }
    },
    listAllApiKeysValidation,
  );
