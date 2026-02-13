import { t } from 'elysia'; 
import {faker} from "@faker-js/faker"
import { SchemaSourceType } from '../../workflow/models';
/**
 * Tenant Validators
 * Elysia validators for tenant-related API endpoints
 */

/**
 * Create Tenant Request Validator
 */
export const createTenantValidator = t.Object({
  businessName: t.String({ minLength: 2, maxLength: 200, examples:[faker.company.name()] }),
  tin: t.String({ minLength: 10, maxLength: 20 , examples: [`${faker.string.numeric({length: 8})}-${faker.string.numeric({length: 4})}`]}),
  businessRegistrationNumber: t.String({ minLength: 5, maxLength: 50 }),
  contactEmail: t.String({ format: 'email', examples: [faker.internet.email()] }),
  contactPhone: t.String({ minLength: 10, maxLength: 20 }),
  erpSystem: t.Enum(SchemaSourceType), 
  expectedVolume: t.Optional(t.Number({ minimum: 1 })),
});

/**
 * Update Tenant Request Validator
 */
export const updateTenantValidator = t.Object({
  businessName: t.Optional(t.String({ minLength: 2, maxLength: 200 })),
  contactEmail: t.Optional(t.String({ format: 'email' })),
  contactPhone: t.Optional(t.String({ minLength: 10, maxLength: 20 })), 
  webhookUrl: t.Optional(t.String({ format: 'uri' })),
  webhookEnabled: t.Optional(t.Boolean()),
  features: t.Optional(
    t.Object({
      autoFix: t.Optional(t.Boolean()),
      maxRetries: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
      qrCodeGeneration: t.Optional(t.Boolean()),
    })
  ),
  erpSystem: t.Optional(t.Enum(SchemaSourceType)), 
  limits: t.Optional(
    t.Object({
      monthlyInvoiceLimit: t.Optional(t.Number({ minimum: 0 })),
      apiRateLimit: t.Optional(t.Number({ minimum: 10, maximum: 10000 })),
    })
  ),
});

/**
 * Update FIRS Credentials Validator
 */
export const updateFirsCredentialsValidator = t.Object({ 
  certificate: t.String({ minLength: 30, examples:[faker.string.alphanumeric({length: 30})] }),
  publicKey: t.String({ minLength: 50, examples:[faker.string.alphanumeric({length: 50})]  })
});

/**
 * Tenant ID Path Parameter Validator
 */
export const tenantIdParamValidator = t.Object({
  tenantId: t.String( ),
});

/**
 * Query Parameters for List Tenants
 */
export const listTenantsQueryValidator = t.Object({
  page: t.Optional(t.Number({ minimum: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, })),
  status: t.Optional(
    t.Union([t.Literal('active'), t.Literal('suspended'), t.Literal('inactive')])
  ),
  onboarding: t.Optional(t.Boolean({default: true})),
  search: t.Optional(t.String()),
  sortBy: t.Optional(t.String()),
  sortOrder: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
});

/**
 * Create API Key Request Validator
 */
export const createApiKeyValidator = t.Object({
  name: t.String({ minLength: 3, maxLength: 100 }),
  scopes: t.Optional(t.Array(t.String())),
  expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 3650 })),
});

/**
 * API Key ID Path Parameter Validator
 */
export const apiKeyIdParamValidator = t.Object({
  keyId: t.String(),
});

/**
 * Revoke API Key Request Validator
 */
export const revokeApiKeyValidator = t.Object({
  reason: t.Optional(t.String({ minLength: 5, maxLength: 500 })),
});

/**
 * Onboarding Status Update Validator
 */
export const updateOnboardingStatusValidator = t.Object({
  status: t.Optional(t.Union([
    t.Literal('pending'),
    t.Literal('in_progress'),
    t.Literal('testing'),
    t.Literal('active'),
    t.Literal('rejected'),
  ])),
  notes: t.Optional(t.String()),
  rejectionReason: t.Optional(t.String()),
});

/**
 * ERP Sync Configuration Validator
 */
export const erpSyncConfigValidator = t.Object({
  name: t.String({ minLength: 3, maxLength: 100 }),
  description: t.Optional(t.String({ maxLength: 500 })),
  enabled: t.Boolean({ default: true }),
  method: t.Union([
    t.Literal('GET'),
    t.Literal('POST'),
    t.Literal('PUT'),
    t.Literal('PATCH'),
    t.Literal('DELETE'),
  ]),
  baseUrl: t.String({ format: 'uri' }),
  endpoint: t.String({ minLength: 1 }),
  headers: t.Optional(t.Record(t.String(), t.String(), {default: {"key":"value"}})),
  queryParams: t.Optional(t.Record(t.String(), t.String(), {default: {"key":"value"}})),
  bodyTemplate: t.Optional(t.String()),
  authentication: t.Optional(t.Object({
    type: t.Union([
      t.Literal('none'),
      t.Literal('basic'),
      t.Literal('bearer'),
      t.Literal('api-key'),
      t.Literal('oauth2'),
    ]),
    username: t.Optional(t.String()),
    password: t.Optional(t.String()),
    token: t.Optional(t.String()),
    apiKeyName: t.Optional(t.String()),
    apiKeyValue: t.Optional(t.String()),
    apiKeyLocation: t.Optional(t.Union([t.Literal('header'), t.Literal('query')])),
  })),
  timeout: t.Optional(t.Number({ minimum: 1000, maximum: 300000, default: 30000 })),
  retryConfig: t.Optional(t.Object({
    maxRetries: t.Number({ minimum: 0, maximum: 5, default: 3 }),
    retryDelay: t.Number({ minimum: 100, maximum: 10000, default: 1000 }),
    retryOn: t.Optional(t.Array(t.Number())),
  })),
  responseMapping: t.Optional(t.Record(t.String(), t.String(),{default: {"key":"value"}})),
  triggerEvents: t.Optional(t.Array(t.Union([
    t.Literal('invoice.validated'),
    t.Literal('invoice.signed'),
    t.Literal('invoice.transmitted'),
    t.Literal('invoice.received'),
    t.Literal('invoice.acknowledged'),
  ]))),
});
