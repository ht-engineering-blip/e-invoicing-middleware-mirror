import { t } from 'elysia';
import {
  apiKeyIdParamValidator,
  createApiKeyValidator,
  createTenantValidator,
  erpSyncConfigValidator,
  listTenantsQueryValidator,
  revokeApiKeyValidator,
  tenantIdParamValidator,
  updateOnboardingStatusValidator,
  updateTenantValidator
} from '../utils/tenant.validators';

export const createTenantValidation = {
  body: createTenantValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - Tenants'],
    security: [{ adminKey: [] }],
    summary: 'Create a new tenant',
    description: 'Create a new tenant with business information and ERP configuration',
  },
};

export const listTenantsValidation = {
  query: listTenantsQueryValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - Tenants'],
    security: [{ adminKey: [] }],
    summary: 'List all tenants',
    description: 'Get paginated list of tenants with optional filtering',
  },
};

export const getTenantByIdValidation = {
  params: tenantIdParamValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - Tenants', 'Tenant'],
    security: [{ adminKey: [] }, { bearerToken: [] }] as any,
    summary: 'Get tenant by ID',
    description: 'Retrieve detailed information about a specific tenant',
  },
};

export const updateTenantValidation = {
  params: tenantIdParamValidator,
  body: updateTenantValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - Tenants'],
    security: [{ adminKey: [] }],
    summary: 'Update tenant',
    description: 'Update tenant information (business details, limits, features)',
  },
};

export const activateTenantValidation = {
  params: tenantIdParamValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - Tenants'],
    security: [{ adminKey: [] }],
    summary: 'Activate tenant',
    description: 'Activate a suspended tenant account',
  },
};

export const suspendTenantValidation = {
  params: tenantIdParamValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - Tenants'],
    security: [{ adminKey: [] }],
    summary: 'Suspend tenant',
    description: 'Suspend a tenant account (reversible)',
  },
};

export const deleteTenantValidation = {
  params: tenantIdParamValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - Tenants'],
    security: [{ adminKey: [] }],
    summary: 'Delete tenant',
    description: 'Permanently delete a tenant (use with caution)',
  },
};

export const updateOnboardingStatusValidation = {
  params: tenantIdParamValidator,
  body: updateOnboardingStatusValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - Tenants'],
    security: [{ adminKey: [] }],
    summary: 'Update onboarding status',
    description: 'Update the onboarding progress for a tenant',
  },
};

export const createApiKeyValidation = {
  params: tenantIdParamValidator,
  body: createApiKeyValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - API Keys'],
    security: [{ adminKey: [] }],
    summary: 'Create API key',
    description: 'Generate a new API key for tenant authentication',
  },
};

export const listApiKeysValidation = {
  params: tenantIdParamValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - API Keys'],
    security: [{ adminKey: [] }],
    summary: 'List API keys',
    description: 'Get all API keys for a tenant',
  },
};

export const revokeApiKeyValidation = {
  params: t.Composite([tenantIdParamValidator, apiKeyIdParamValidator]),
  body: revokeApiKeyValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - API Keys'],
    security: [{ adminKey: [] }],
    summary: 'Revoke API key',
    description: 'Permanently revoke an API key',
  },
};

export const rotateApiKeyValidation = {
  params: t.Composite([tenantIdParamValidator, apiKeyIdParamValidator]),
  body: t.Object({
    reason: t.Optional(t.String()),
    sendEmail: t.Optional(t.Boolean({ default: true })),
  }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - API Keys'],
    security: [{ adminKey: [] }],
    summary: 'Rotate API key',
    description: 'Revoke old API key and generate a new one. Tenant receives an email with the new key.',
  },
};

export const listAllApiKeysValidation = {
  query: t.Object({
    page: t.Optional(t.Numeric()),
    limit: t.Optional(t.Numeric()),
    status: t.Optional(t.String()),
    tenantId: t.Optional(t.String()),
  }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - API Keys'],
    security: [{ adminKey: [] }],
    summary: 'List all API keys',
    description: 'Get a list of all API keys across all tenants with filtering and pagination. Admin only.',
  },
};

export const listAllERPConfigsValidation = {
  query: t.Object({
    page: t.Optional(t.Numeric()),
    limit: t.Optional(t.Numeric()),
    erpSystem: t.Optional(t.String()),
    enabled: t.Optional(t.String()),
  }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - ERP Integration'],
    security: [{ adminKey: [] }],
    summary: 'List all ERP configurations',
    description: 'Get a list of all ERP configurations across all tenants with filtering options',
  },
};

export const configureERPSyncValidation = {
  params: tenantIdParamValidator,
  body: erpSyncConfigValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - ERP Integration', 'Tenant'],
    security: [{ adminKey: [] }],
    summary: 'Configure ERP sync',
    description: 'Configure dynamic HTTP payload composition for ERP synchronization. Supports template-based request building with authentication, retries, and response mapping.',
  },
};

export const getERPSyncConfigValidation = {
  params: tenantIdParamValidator,
  query: t.Object({
    decrypt: t.Optional(t.String({ default: 'true' })),
  }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - ERP Integration', 'Tenant'],
    security: [{ adminKey: [] }],
    summary: 'Get ERP sync configuration',
    description: 'Retrieve the current ERP sync configuration with decrypted credentials',
  },
};

export const resendTenantTokenValidation = {
  params: tenantIdParamValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - Tenants'],
    security: [{ adminKey: [] }],
    summary: 'Resend Tenant Onboarding Token',
    description: 'Admin trigger to check timeframe of existing token, invalidate/delete if valid, and resend new activation token email to tenant contact email.',
  },
};
