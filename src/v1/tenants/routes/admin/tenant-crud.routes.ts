import { Elysia } from "elysia";
import { appConfig } from "../../../../@config";
import { logger, ResponseBuilder } from "../../../../@lib";
import { MailContent, withTemplate } from "../../../../@lib/messaging";
import { requireAuth, getActor } from "../../../../middlewares/auth";
import { AuthService } from "../../../auth/services";
import { onlyAdmin, onlySelf, onlyTenantAdmin } from "../../../auth/utils/access-checks";
import { TenantService } from "../../services/tenant.service";
import { AuditService } from "../../../audit/services/audit.service";
import { AuditEventType, AuditEventSeverity } from "../../../audit/models";
import { templateEngine } from "../../../../templates/engine";
import {
  createTenantValidation,
  listTenantsValidation,
  getTenantAnalyticsValidation,
  getTenantByIdValidation,
  updateTenantValidation,
  activateTenantValidation,
  suspendTenantValidation,
  deleteTenantValidation,
  resendTenantTokenValidation,
} from "../../validations/admin.validation";

export const adminTenantCrudRoutes = new Elysia()
  .use(requireAuth)
  .decorate("tenantService", new TenantService())
  .decorate("authService", new AuthService())
  .decorate("auditService", new AuditService())

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

        const isObject = typeof tenant.toObject === "function";
        const rawTenant = isObject ? tenant.toObject() : tenant;

        const activationToken = await authService.createAuthToken(
          {
            ...rawTenant,
            activationTokenId: tenant.metadata?.activationTokenId,
          },
          "12HRS",
        );
        const activationLink = `${appConfig?.webAppURL}/auth/activate?_u=${activationToken}`;
        const activationEmail: MailContent = {
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
        logger.error("Error creating tenant", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to create tenant",
          error.statusCode || 500,
        );
      }
    },
    createTenantValidation,
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
        const page = Math.max(1, parseInt(String(query?.page || "1"), 10));
        const limit = Math.min(
          100,
          Math.max(1, parseInt(String(query?.limit || "20"), 10)),
        );
        const result = await tenantService.listTenants(query as any);
        return ResponseBuilder.paginate(
          result.tenants,
          result.total,
          page,
          limit,
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error listing tenants", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to list tenants",
          error.statusCode || 500,
        );
      }
    },
    listTenantsValidation,
  )

  /**
   * GET /api/v1/tenants/analytics
   * Get overall tenant analytics
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
        logger.error("Error fetching tenant analytics", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to fetch tenant analytics",
          error.statusCode || 500,
        );
      }
    },
    getTenantAnalyticsValidation,
  )

  /**
   * GET /api/v1/tenants/:tenantId
   * Get tenant by ID
   */
  .get(
    "/:tenantId",
    async ({ auth, params, tenantService, set }) => {
      try {
        onlySelf(auth!, params.tenantId);
        const tenant = await tenantService.getTenantById(params.tenantId);
        return ResponseBuilder.success(
          tenant,
          undefined,
          "Tenant retrieved successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error fetching tenant", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to fetch tenant",
          error.statusCode || 500,
        );
      }
    },
    getTenantByIdValidation,
  )

  /**
   * PUT /api/v1/tenants/:tenantId
   * Update tenant
   */
  .put(
    "/:tenantId",
    async ({ auth, params, body, tenantService, set }) => {
      try {
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
        logger.error("Error updating tenant", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to update tenant",
          error.statusCode || 500,
        );
      }
    },
    updateTenantValidation,
  )

  /**
   * PATCH /api/v1/tenants/:tenantId
   * Partial update tenant
   */
  .patch(
    "/:tenantId",
    async ({ auth, params, body, tenantService, set }) => {
      try {
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
        logger.error("Error updating tenant", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to update tenant",
          error.statusCode || 500,
        );
      }
    },
    updateTenantValidation,
  )

  /**
   * POST /api/v1/tenants/:tenantId/activate
   * Activate tenant
   */
  .post(
    "/:tenantId/activate",
    async ({ auth, params, tenantService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
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
        logger.error("Error activating tenant", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to activate tenant",
          error.statusCode || 500,
        );
      }
    },
    activateTenantValidation,
  )

  /**
   * POST /api/v1/tenants/:tenantId/suspend
   * Suspend tenant
   */
  .post(
    "/:tenantId/suspend",
    async ({ auth, params, body, tenantService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        const tenant = await tenantService.suspendTenant(
          params.tenantId,
          (body as any)?.reason,
          getActor(auth),
        );
        return ResponseBuilder.success(
          tenant,
          undefined,
          "Tenant suspended successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error suspending tenant", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to suspend tenant",
          error.statusCode || 500,
        );
      }
    },
    suspendTenantValidation,
  )

  /**
   * DELETE /api/v1/tenants/:tenantId
   * Delete tenant
   */
  .delete(
    "/:tenantId",
    async ({ auth, params, tenantService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        await tenantService.deleteTenant(params.tenantId, getActor(auth));
        return ResponseBuilder.success(
          null,
          undefined,
          "Tenant deleted successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error deleting tenant", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to delete tenant",
          error.statusCode || 500,
        );
      }
    },
    deleteTenantValidation,
  )

  /**
   * POST /api/v1/tenants/:tenantId/resend-token
   * Resend activation token
   */
  .post(
    "/:tenantId/resend-token",
    async ({ auth, params, tenantService, authService, auditService, set }) => {
      try {
        onlyAdmin(auth!, "Forbidden: Admin access required");
        const tenant = await tenantService.getTenantById(params.tenantId);

        const isObject = typeof tenant.toObject === "function";
        const rawTenant = isObject ? tenant.toObject() : tenant;
        const activationToken = await authService.createAuthToken(
          {
            ...rawTenant,
            activationTokenId: tenant.metadata?.activationTokenId,
          },
          "12HRS",
        );
        const activationLink = `${appConfig?.webAppURL}/auth/activate?_u=${activationToken}`;
        const activationEmail: MailContent = {
          subject: "Welcome to HT Invoicing",
          html: withTemplate(
            templateEngine.render("newTenants", { activationLink }),
          ),
        };
        await tenantService.notifyTenant(activationEmail, tenant);

        const route = `/api/v1/tenants/${params.tenantId}/resend-token`;
        await auditService.createAuditLog({
          tenantId: tenant.tenantId,
          eventType: AuditEventType.TENANT_UPDATED,
          severity: AuditEventSeverity.INFO,
          actorType: "user",
          actorId: auth?.userId || "admin",
          actorName: auth?.email || "Admin",
          resourceType: "tenant_activation_token",
          resourceId: tenant.tenantId,
          resourceName: tenant.businessName,
          description: `Admin resent activation token for tenant ${tenant.businessName}`,
          metadata: {
            route,
            token: activationToken,
            activationTokenId: tenant.metadata?.activationTokenId,
            activationLink,
            contactEmail: tenant.contactEmail,
            businessName: tenant.businessName,
          },
        });

        return ResponseBuilder.success(
          tenant,
          undefined,
          "Activation token resent successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Error resending activation token", {
          tenantId: params.tenantId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to resend activation token",
          error.statusCode || 500,
        );
      }
    },
    resendTenantTokenValidation,
  );
