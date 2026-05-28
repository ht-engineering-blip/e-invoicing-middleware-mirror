import { Elysia } from 'elysia';
import { requireAuth } from '../../../middlewares/auth';
import { logger } from '../../../@lib';
import { TenantService } from '../services/tenant.service';
import { onlySelf } from '../../auth/utils/access-checks';
import {
  getBusinessInfoValidation,
  updateBusinessInfoValidation
} from '../validations/settings.validation';

/**
 * Tenant Settings Routes
 */
export const settingsRoutes = new Elysia({ prefix: '/:tenantId/settings' })
  .use(requireAuth)
  .decorate('tenantService', new TenantService())

  /**
   * GET /tenants/:tenantId/settings/business
   * Get business information
   */
  .get(
    '/business',
    async ({ params, auth, tenantService }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId)

        const tenant = await tenantService.getTenantById(params.tenantId);

        return {
          success: true,
          data: {
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
          },
        };
      } catch (error: any) {
        logger.error('Failed to get business info', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to get business information',
          statusCode: error.statusCode || 500,
        };
      }
    },
    getBusinessInfoValidation
  )

  /**
   * PUT /tenants/:tenantId/settings/business
   * Update business information
   */
  .put(
    '/business',
    async ({ params, body, auth, tenantService }) => {
      try {
        // Check authorization
onlySelf(auth!, params.tenantId)

        const tenant = await tenantService.getTenantById(params.tenantId);

        // Build update data (cannot update TIN or BRN)
        const updateData: any = {};

        if (body.businessName) updateData.businessName = body.businessName;
        if (body.contactEmail) updateData.contactEmail = body.contactEmail;
        if (body.contactPhone) updateData.contactPhone = body.contactPhone;

        // Update metadata for address, website, industry
        if (body.address || body.website || body.industry) {
          updateData.metadata = {
            ...tenant.metadata,
            ...(body.address && { address: body.address }),
            ...(body.website && { website: body.website }),
            ...(body.industry && { industry: body.industry }),
          };
        }

        const updatedTenant = await tenantService.updateTenant(params.tenantId, updateData);

        return {
          success: true,
          message: 'Business information updated successfully',
          data: {
            businessName: updatedTenant.businessName,
            tin: updatedTenant.tin,
            businessRegistrationNumber: updatedTenant.businessRegistrationNumber,
            contactEmail: updatedTenant.contactEmail,
            contactPhone: updatedTenant.contactPhone,
            address: updatedTenant.metadata?.address,
            website: updatedTenant.metadata?.website,
            industry: updatedTenant.metadata?.industry,
          },
        };
      } catch (error: any) {
        logger.error('Failed to update business info', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to update business information',
          statusCode: error.statusCode || 500,
        };
      }
    },
    updateBusinessInfoValidation
  );
