import { Elysia } from 'elysia';
import { requireAuth } from '../../../middlewares/auth';
import { logger } from '../../../@lib';
import { TenantService } from '../services/tenant.service';
import { jwtConfig, appConfig } from '../../../@config';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import axios from 'axios';
import { encryptSensitiveData } from '../../../@lib/crypto';
import { onlySelf } from '../../auth/utils/access-checks';
import { WebhookService } from '../../webhook/services/webhook.service';
import { signWebhookPayload } from '../../webhook';
import {
  activateValidation,
  updateCredentialsValidation,
  generateWebhookValidation,
  updateInvoiceIdKeyValidation,
  testWebhookValidation
} from '../validations/onboarding.validation';

function getActor(auth: any) {
  if (!auth) return undefined;
  return {
    id: auth.userId || auth.tenantId || 'system',
    type: auth.isAdmin ? 'system' : (auth.apiKeyId ? 'api_key' : 'user'),
    name: auth.email || auth.businessName || (auth.isAdmin ? 'Admin' : 'System'),
  };
}

/**
 * Public Onboarding Routes (no auth required)
 */
export const publicOnboardingRoutes = new Elysia()
  .decorate('tenantService', new TenantService())
  .decorate('webhookService', new WebhookService())

  /**
   * GET /tenants/activate/:token
   * Handle activation link click
   */
  .get(
    '/activate/:token',
    async ({ params, tenantService, set }) => {
      try {
        logger.info('Activation link clicked');

        // Verify JWT token
        const jwtSecret = jwtConfig?.secret as string;
        let decoded: any;

        try {
          decoded = jwt.verify(params.token, jwtSecret, {
            algorithms: [jwtConfig?.algorithm as jwt.Algorithm || 'HS256']
          });
        } catch (jwtError: any) {
          logger.warn('Invalid activation token', { error: jwtError.message });
          return {
            success: false,
            error: 'Invalid or expired activation link',
            statusCode: 400,
          };
        }

        if (!decoded.tenantId) {
          return {
            success: false,
            error: 'Invalid activation token',
            statusCode: 400,
          };
        }

        // Get tenant
        const tenant = await tenantService.getTenantById(decoded.tenantId);

        // Check if already activated
        if (tenant.password || tenant.metadata?.activationCompleted) {
          return {
            success: false,
            error: 'Account has already been activated',
            statusCode: 400,
          };
        }

        // Generate a new short-lived token for password setting
        const setPasswordToken = jwt.sign(
          {
            tenantId: tenant.tenantId,
            email: tenant.contactEmail,
            purpose: 'set-password',
          },
          jwtSecret,
          {
            expiresIn: '1h',
            algorithm: (jwtConfig?.algorithm as jwt.Algorithm) || 'HS256'
          }
        );

        // Return redirect info or token
        const webAppUrl = appConfig?.webAppURL || 'http://localhost:3000';
        const redirectUrl = `${webAppUrl}/auth/set-password?token=${setPasswordToken}`;

        return {
          success: true,
          message: 'Activation link valid',
          data: {
            tenantId: tenant.tenantId,
            businessName: tenant.businessName,
            email: tenant.contactEmail,
            setPasswordToken,
            redirectUrl,
          },
        };
      } catch (error: any) {
        logger.error('Activation link handling failed', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to process activation link',
          statusCode: error.statusCode || 500,
        };
      }
    },
    activateValidation
  );

/**
 * Protected Onboarding Routes
 */
export const protectedOnboardingRoutes = new Elysia()
  .use(requireAuth)
  .decorate('tenantService', new TenantService())
  .decorate('webhookService', new WebhookService())
  /**
   * PUT /tenants/:tenantId/credentials
   * Update tenant's public key and certificate
   */
  .put(
    '/:tenantId/credentials',
    async ({ params, body, auth, tenantService }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId)

        logger.info('Updating tenant credentials', { tenantId: params.tenantId });

        // Validate certificate format (basic check)
        if (body.certificate && !body.certificate.includes('-----BEGIN CERTIFICATE-----')) {
          return {
            success: false,
            error: 'Invalid certificate format. Must be PEM encoded.',
            statusCode: 400,
          };
        }

        // Validate public key format (basic check)
        if (body.publicKey && !body.publicKey.includes('-----BEGIN')) {
          return {
            success: false,
            error: 'Invalid public key format. Must be PEM encoded.',
            statusCode: 400,
          };
        }

        // Update credentials
        const updatedTenant = await tenantService.updateFIRSCredentials(params.tenantId, {
          certificate: body.certificate,
          publicKey: body.publicKey,
        }, getActor(auth));

        // Update onboarding step if not already completed
        try {
          const onboarding = await tenantService.getOnboardingStatus(params.tenantId);
          if (onboarding && !onboarding.steps?.firsProvisioning?.completed) {
            await tenantService.completeOnboardingStep(params.tenantId, 'firsProvisioning', getActor(auth));
          }
        } catch (onboardingError) {
          logger.warn('Failed to update onboarding step', { error: onboardingError });
        }

        return {
          success: true,
          message: 'Credentials updated successfully',
          data: {
            tenantId: updatedTenant.tenantId,
            hasCredentials: true,
          },
        };
      } catch (error: any) {
        logger.error('Failed to update credentials', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to update credentials',
          statusCode: error.statusCode || 500,
        };
      }
    },
    updateCredentialsValidation
  )

  /**
   * POST /tenants/:tenantId/webhook/generate
   * Generate webhook URL for tenant
   */
  .post(
    '/:tenantId/webhook/generate',
    async ({ params, body, auth, tenantService, webhookService }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId)

        logger.info('Generating webhook URL', { tenantId: params.tenantId });

        // Generate unique webhook path
        const webhookPath = crypto.randomBytes(16).toString('hex');
        const webhookSecret = crypto.randomBytes(32).toString('hex');

        // Build webhook URL
        const baseUrl = appConfig?.apiBaseURL || 'http://localhost:3000';
        const webhookUrl = `${baseUrl}/v1/webhook/inbound/${webhookPath}`;

        // Load current tenant to merge existing config
        const tenant = await tenantService.getTenantById(params.tenantId);

        // Persist invoiceIdKey if provided; otherwise keep existing value
        const invoiceIdKey = body?.invoiceIdKey ?? tenant.config?.invoiceIdKey;

        // Encrypt webhook secret
        const encryptedSecret = encryptSensitiveData(webhookSecret);

        await tenantService.updateTenant(params.tenantId, {
          webhookUrl,
          webhookEnabled: true,
          config: {
            ...tenant.config,
            invoiceIdKey,
          },
          metadata: {
            ...tenant.metadata,
            webhookUrl,
            webhookPath,
            webhookSecretHash: crypto.createHash('sha256').update(webhookSecret).digest('hex'),
          },
        } as any, getActor(auth));

        await webhookService.configureWebhook({ enabled: true, tenantId: params.tenantId, webhookUrl, webhookSecret })

        return {
          success: true,
          message: 'Webhook URL generated successfully',
          data: {
            webhookUrl,
            webhookSecret, // Only shown once
            webhookPath,
            invoiceIdKey: invoiceIdKey ?? null,
            instructions: 'Save the webhook secret securely. It will not be shown again.',
          },
        };
      } catch (error: any) {
        logger.error('Failed to generate webhook URL', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to generate webhook URL',
          statusCode: error.statusCode || 500,
        };
      }
    },
    generateWebhookValidation
  )
  /**
   * PUT /tenants/:tenantId/invoice-id-key
   * Update Invoice ID Key for tenant
   */
  .put(
    '/:tenantId/invoice-id-key',
    async ({ params, body, auth, tenantService, webhookService }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId)

        logger.info('Updating Invoice ID Key', { tenantId: params.tenantId });
 
        // Load current tenant to merge existing config
        const tenant = await tenantService.getTenantById(params.tenantId);

        // Persist invoiceIdKey if provided; otherwise keep existing value
        const invoiceIdKey = body?.invoiceIdKey ?? tenant.config?.invoiceIdKey;
 

        await tenantService.updateTenant(params.tenantId, { 
          config: {
            ...tenant.config,
            invoiceIdKey,
          }
        } as any, getActor(auth));

        
        return {
          success: true,
          message: 'Invoice ID Key updated successfully',
          data: { 
            invoiceIdKey: invoiceIdKey ?? null, 
          },
        };
      } catch (error: any) {
        logger.error('Failed to update invoice id key', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to update invoice id key',
          statusCode: error.statusCode || 500,
        };
      }
    },
    updateInvoiceIdKeyValidation
  )

  /**
   * POST /tenants/:tenantId/webhook/test
   * Test webhook connectivity
   */
  .post(
    '/:tenantId/webhook/test',
    async ({ params, body, auth, tenantService }) => {
      try {
        // Check authorization
        onlySelf(auth!, params.tenantId)

        logger.info('Testing webhook', { tenantId: params.tenantId });

        const tenant = await tenantService.getTenantById(params.tenantId);

        if (!tenant.metadata?.webhookUrl) {
          return {
            success: false,
            error: 'Webhook URL not configured. Generate one first.',
            statusCode: 400,
          };
        }

        const secret = tenant.config?.webhookAuth;
        if (!secret) {
          return {
            success: false,
            error: 'Webhook secret not configured for this tenant. Generate one first.',
            statusCode: 400,
          };
        }

        // Create test payload
        const testPayload = body?.testPayload || {
          event: 'webhook.test',
          tenantId: params.tenantId,
          timestamp: new Date().toISOString(),
          data: {
            message: 'This is a test webhook from E-Invoicing Platform',
            irn: 'TEST-IRN-' + Date.now(),
          },
        };

        // Generate signature for the payload using both formats for backward compatibility
        const payloadString = JSON.stringify(testPayload);
        const legacySignature = crypto.createHmac("sha256", secret).update(payloadString).digest("hex");
        const now = Math.floor(Date.now() / 1000);
        const signature = signWebhookPayload(secret, now, payloadString);

        // Send test webhook
        let testResult: any = {
          success: false,
          statusCode: 0,
          responseTime: 0,
          error: null,
        };

        const startTime = Date.now();

        try {
          const response = await axios.post(tenant.metadata.webhookUrl, testPayload, {
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Key': legacySignature,
              'X-Webhook-Signature': `t=${now},v1=${signature}`,
              'X-Webhook-Event': 'webhook.test',
            },
            timeout: 10000, // 10 second timeout
          });

          testResult = {
            success: true,
            statusCode: response.status,
            responseTime: Date.now() - startTime,
            response: response.data,
          };
        } catch (webhookError: any) {
          console.log({ webhookError })
          testResult = {
            success: false,
            statusCode: webhookError.response?.status || 0,
            responseTime: Date.now() - startTime,
            error: webhookError.message,
          };
        }

        // Update onboarding step if test was successful
        if (testResult.success) {
          try {
            const onboarding = await tenantService.getOnboardingStatus(params.tenantId);
            if (onboarding && !onboarding.steps?.testing?.completed) {
              await tenantService.completeOnboardingStep(params.tenantId, 'testing', getActor(auth));
            }
          } catch (onboardingError) {
            logger.warn('Failed to update onboarding step', { error: onboardingError });
          }
        }

        return {
          success: true,
          message: testResult.success ? 'Webhook test successful' : 'Webhook test failed',
          data: {
            webhookUrl: tenant.metadata.webhookUrl,
            testResult,
            payload: testPayload,
          },
        };
      } catch (error: any) {
        logger.error('Failed to test webhook', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to test webhook',
          statusCode: error.statusCode || 500,
        };
      }
    },
    testWebhookValidation
  );
