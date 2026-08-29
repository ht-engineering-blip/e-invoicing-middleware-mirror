import { Elysia } from "elysia";
import { getActor, requireAuth } from "../../../middlewares/auth";
import { logger, ResponseBuilder, UnauthorizedError } from "../../../@lib";
import { TenantService } from "../services/tenant.service";
import { onlySelf } from "../../auth/utils/access-checks";
import {
  getBusinessInfoValidation,
  updateBusinessInfoValidation,
  requestEmailChangeValidation,
  verifyEmailChangeValidation,
} from "../validations/settings.validation";

/**
 * Tenant Settings Routes
 */
export const settingsRoutes = new Elysia({ prefix: "/:tenantId/settings" })
  .use(requireAuth)
  .decorate("tenantService", new TenantService())

  /**
   * GET /tenants/:tenantId/settings/business
   * Get business information
   */
  .get(
    "/business",
    async ({ params, auth, tenantService, set }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId);

        const tenant = await tenantService.getTenantById(params.tenantId);

        return ResponseBuilder.success({
          businessName: tenant.businessName,
          tin: tenant.tin,
          businessRegistrationNumber: tenant.businessRegistrationNumber,
          contactEmail: tenant.contactEmail,
          contactPhone: tenant.contactPhone,
          erpSystem: tenant.config?.erpSystem,
          expectedVolume: tenant.expectedVolume,
          address: tenant.metadata?.address || null,
          website: tenant.metadata?.website || null,
          industry: tenant.metadata?.industry || null,
        });
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to get business info", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to get business information",
          error.statusCode || 500,
        );
      }
    },
    getBusinessInfoValidation,
  )

  /**
   * PUT /tenants/:tenantId/settings/business
   * Update business information
   */
  .put(
    "/business",
    async ({ params, body, auth, tenantService, set }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId);

        const tenant = await tenantService.getTenantById(params.tenantId);
        const tenantObj = tenant.toObject();

        // Build update data (cannot update TIN or BRN)
        const updateData: any = {};

        if (body.businessName) updateData.businessName = body.businessName;
        if (body.contactEmail) updateData.contactEmail = body.contactEmail;
        if (body.contactPhone) updateData.contactPhone = body.contactPhone;

        // Update metadata for address, website, industry
        if (body.address || body.website || body.industry) {
          updateData.metadata = {
            ...tenantObj.metadata,
            ...(body.address && { address: body.address }),
            ...(body.website && { website: body.website }),
            ...(body.industry && { industry: body.industry }),
          };
        }

        const updatedTenant = await tenantService.updateTenant(
          params.tenantId,
          updateData,
          getActor(auth),
        );

        return ResponseBuilder.success(
          {
            businessName: updatedTenant.businessName,
            tin: updatedTenant.tin,
            businessRegistrationNumber:
              updatedTenant.businessRegistrationNumber,
            contactEmail: updatedTenant.contactEmail,
            contactPhone: updatedTenant.contactPhone,
            address: updatedTenant.metadata?.address,
            website: updatedTenant.metadata?.website,
            industry: updatedTenant.metadata?.industry,
          },
          undefined,
          "Business information updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to update business info", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to update business information",
          error.statusCode || 500,
        );
      }
    },
    updateBusinessInfoValidation,
  )

  /**
   * POST /tenants/:tenantId/settings/email/request-change
   * Request email change verification link
   */
  .post(
    "/email/request-change",
    async ({ params, body, auth, tenantService, set }) => {
      try {
        const tenantId = auth?.tenantId || params?.tenantId;
        if (!tenantId) {
          throw new UnauthorizedError("Tenant authentication required");
        }

        const result = await tenantService.requestEmailChange(
          tenantId,
          body.newEmail,
          getActor(auth),
          body.currentPassword,
        );

        return ResponseBuilder.success(result, undefined, result.message);
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to request email change", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to request email change",
          error.statusCode || 500,
        );
      }
    },
    requestEmailChangeValidation,
  )

  /**
   * POST /tenants/:tenantId/settings/email/verify
   * Verify token and complete contact email update
   */
  .post(
    "/email/verify",
    async ({ params, body, query, auth, tenantService, set }) => {
      try {
        const tenantId = auth?.tenantId || params?.tenantId;
        if (!tenantId) {
          throw new UnauthorizedError("Tenant authentication required");
        }

        const token =
          body?.token || body?._u || query?.token || query?._u || "";

        const result = await tenantService.verifyEmailChange(
          tenantId,
          token,
          getActor(auth),
        );

        return ResponseBuilder.success(result, undefined, result.message);
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to verify email change", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to verify email change",
          error.statusCode || 500,
        );
      }
    },
    verifyEmailChangeValidation,
  );
