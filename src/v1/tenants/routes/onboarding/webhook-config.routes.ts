import { Elysia } from "elysia";
import * as crypto from "crypto";
import axios from "axios";
import { appConfig } from "../../../../@config";
import { logger, ResponseBuilder } from "../../../../@lib";
import { requireAuth, getActor } from "../../../../middlewares/auth";
import { onlyTenantAdmin } from "../../../auth/utils/access-checks";
import { TenantService } from "../../services/tenant.service";
import {
  signWebhookPayload,
  calculateWebhookExpiry,
  isWebhookExpired,
} from "../../../webhook";
import {
  getWebhookConfigValidation,
  generateWebhookValidation,
  updateInvoiceIdKeyValidation,
  testWebhookValidation,
} from "../../validations/onboarding.validation";

export const onboardingWebhookRoutes = new Elysia()
  .use(requireAuth)
  .decorate("tenantService", new TenantService())

  /**
   * GET /tenants/:tenantId/webhook/config
   * Retrieve current webhook configuration, lifespan, and expiration status
   */
  .get(
    "/:tenantId/webhook/config",
    async ({ params, auth, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        const tenant = await tenantService.getTenantById(params.tenantId);
        const isObject = typeof tenant.toObject === "function";
        const tenantObj = isObject ? tenant.toObject() : tenant;

        const webhookUrl =
          tenantObj.metadata?.webhookUrl ||
          tenantObj.config?.webhookUrl ||
          null;
        const webhookPath = tenantObj.metadata?.webhookPath || null;
        const webhookEnabled = Boolean(tenantObj.config?.webhookEnabled);
        const invoiceIdKey = tenantObj.config?.invoiceIdKey || "invoiceId";
        const lifespan =
          tenantObj.metadata?.webhookLifespan ||
          tenantObj.config?.webhookLifespan ||
          null;
        const expiresAtRaw =
          tenantObj.metadata?.webhookExpiresAt ||
          tenantObj.config?.webhookExpiresAt ||
          null;

        const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
        const expired = expiresAt ? isWebhookExpired(expiresAt) : false;
        const hasSecret = Boolean(
          tenantObj.metadata?.webhookSecretHash ||
            tenantObj.config?.webhookAuth,
        );

        let remainingDays: number | null = null;
        if (expiresAt && !expired) {
          remainingDays = Math.max(
            0,
            Math.ceil(
              (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
            ),
          );
        }

        return ResponseBuilder.success({
          tenantId: params.tenantId,
          configured: Boolean(webhookUrl && hasSecret),
          webhookUrl,
          webhookPath,
          webhookEnabled,
          invoiceIdKey,
          lifespan,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          isExpired: expired,
          hasSecret,
          remainingDays,
        });
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to get webhook configuration", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to get webhook configuration",
          error.statusCode || 500,
        );
      }
    },
    getWebhookConfigValidation,
  )

  /**
   * GET /tenants/:tenantId/webhook
   * Alias for GET /tenants/:tenantId/webhook/config
   */
  .get(
    "/:tenantId/webhook",
    async ({ params, auth, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        const tenant = await tenantService.getTenantById(params.tenantId);
        const isObject = typeof tenant.toObject === "function";
        const tenantObj = isObject ? tenant.toObject() : tenant;

        const webhookUrl =
          tenantObj.metadata?.webhookUrl ||
          tenantObj.config?.webhookUrl ||
          null;
        const webhookPath = tenantObj.metadata?.webhookPath || null;
        const webhookEnabled = Boolean(tenantObj.config?.webhookEnabled);
        const invoiceIdKey = tenantObj.config?.invoiceIdKey || "invoiceId";
        const lifespan =
          tenantObj.metadata?.webhookLifespan ||
          tenantObj.config?.webhookLifespan ||
          null;
        const expiresAtRaw =
          tenantObj.metadata?.webhookExpiresAt ||
          tenantObj.config?.webhookExpiresAt ||
          null;

        const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
        const expired = expiresAt ? isWebhookExpired(expiresAt) : false;
        const hasSecret = Boolean(
          tenantObj.metadata?.webhookSecretHash ||
            tenantObj.config?.webhookAuth,
        );

        let remainingDays: number | null = null;
        if (expiresAt && !expired) {
          remainingDays = Math.max(
            0,
            Math.ceil(
              (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
            ),
          );
        }

        return ResponseBuilder.success({
          tenantId: params.tenantId,
          configured: Boolean(webhookUrl && hasSecret),
          webhookUrl,
          webhookPath,
          webhookEnabled,
          invoiceIdKey,
          lifespan,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          isExpired: expired,
          hasSecret,
          remainingDays,
        });
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to get webhook configuration", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to get webhook configuration",
          error.statusCode || 500,
        );
      }
    },
    getWebhookConfigValidation,
  )

  /**
   * POST /tenants/:tenantId/webhook/generate
   * Generate webhook URL for tenant
   */
  .post(
    "/:tenantId/webhook/generate",
    async ({ params, body, auth, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        logger.info("Generating webhook URL", { tenantId: params.tenantId });

        const webhookPath = crypto.randomBytes(16).toString("hex");
        const webhookSecret = crypto.randomBytes(32).toString("hex");

        const baseUrl = appConfig?.apiBaseURL || "http://localhost:3000";
        const webhookUrl = `${baseUrl}/v1/webhook/inbound/${webhookPath}`;

        const tenant = await tenantService.getTenantById(params.tenantId);
        const isObject = typeof tenant.toObject === "function";
        const tenantObj = isObject ? tenant.toObject() : tenant;

        const invoiceIdKey =
          body?.invoiceIdKey ?? tenantObj.config?.invoiceIdKey;

        const { lifespan, expiresAt } = calculateWebhookExpiry(body?.lifespan);

        await tenantService.updateTenant(
          params.tenantId,
          {
            webhookUrl,
            webhookEnabled: true,
            webhookExpiresAt: expiresAt,
            webhookLifespan: lifespan,
            config: {
              ...tenantObj.config,
              webhookUrl,
              webhookEnabled: true,
              webhookAuth: webhookSecret,
              webhookExpiresAt: expiresAt,
              webhookLifespan: lifespan,
              invoiceIdKey,
            },
            metadata: {
              ...tenantObj.metadata,
              webhookUrl,
              webhookPath,
              webhookExpiresAt: expiresAt,
              webhookLifespan: lifespan,
              webhookSecretHash: crypto
                .createHash("sha256")
                .update(webhookSecret)
                .digest("hex"),
            },
          },
          getActor(auth),
        );

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
          }
        } catch (onboardingError) {
          logger.warn("Failed to update onboarding step erpConfiguration", {
            error: onboardingError,
          });
        }

        return ResponseBuilder.success(
          {
            webhookUrl,
            webhookSecret,
            webhookPath,
            lifespan,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            invoiceIdKey: invoiceIdKey ?? null,
            instructions:
              "Save the webhook secret securely. It will not be shown again.",
          },
          undefined,
          "Webhook URL generated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to generate webhook URL", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to generate webhook URL",
          error.statusCode || 500,
        );
      }
    },
    generateWebhookValidation,
  )

  /**
   * PUT /tenants/:tenantId/invoice-id-key
   * Update Invoice ID Key for tenant
   */
  .put(
    "/:tenantId/invoice-id-key",
    async ({ params, body, auth, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        logger.info("Updating Invoice ID Key", { tenantId: params.tenantId });

        const tenant = await tenantService.getTenantById(params.tenantId);
        const isObject = typeof tenant.toObject === "function";
        const tenantObj = isObject ? tenant.toObject() : tenant;

        const invoiceIdKey =
          body?.invoiceIdKey ?? tenantObj.config?.invoiceIdKey;

        await tenantService.updateTenant(
          params.tenantId,
          {
            config: {
              ...tenantObj.config,
              invoiceIdKey,
            },
          } as any,
          getActor(auth),
        );

        return ResponseBuilder.success(
          {
            invoiceIdKey: invoiceIdKey ?? null,
          },
          undefined,
          "Invoice ID Key updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to update invoice id key", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to update invoice id key",
          error.statusCode || 500,
        );
      }
    },
    updateInvoiceIdKeyValidation,
  )

  /**
   * POST /tenants/:tenantId/webhook/test
   * Test webhook connectivity
   */
  .post(
    "/:tenantId/webhook/test",
    async ({ params, body, auth, tenantService, set }) => {
      try {
        onlyTenantAdmin(auth!, params.tenantId);

        logger.info("Testing webhook", { tenantId: params.tenantId });

        const tenant = await tenantService.getTenantById(params.tenantId);

        if (!tenant.metadata?.webhookUrl) {
          set.status = 400;
          return ResponseBuilder.error(
            "Webhook URL not configured. Generate one first.",
            400,
          );
        }

        const secret = tenant.config?.webhookAuth;
        if (!secret) {
          set.status = 400;
          return ResponseBuilder.error(
            "Webhook secret not configured for this tenant. Generate one first.",
            400,
          );
        }

        const expiresAt =
          tenant.metadata?.webhookExpiresAt || tenant.config?.webhookExpiresAt;
        if (isWebhookExpired(expiresAt)) {
          set.status = 400;
          return ResponseBuilder.error(
            "Webhook credentials have expired. Generate new credentials first.",
            400,
          );
        }

        const testPayload = body?.testPayload || {
          event: "webhook.test",
          tenantId: params.tenantId,
          timestamp: new Date().toISOString(),
          data: {
            message: "This is a test webhook from E-Invoicing Platform",
            irn: "TEST-IRN-" + Date.now(),
          },
        };

        const payloadString = JSON.stringify(testPayload);
        const now = Math.floor(Date.now() / 1000);
        const signature = signWebhookPayload(secret, now, payloadString);
        const secureKey = `t=${now},v1=${signature}`;

        let testResult: any = {
          success: false,
          statusCode: 0,
          responseTime: 0,
          error: null,
        };

        const startTime = Date.now();

        try {
          const response = await axios.post(
            tenant.metadata.webhookUrl,
            testPayload,
            {
              headers: {
                "Content-Type": "application/json",
                "X-Webhook-Key": secureKey,
                "X-Webhook-Signature": secureKey,
                "X-Webhook-Event": "webhook.test",
              },
              timeout: 10000,
            },
          );

          testResult = {
            success: true,
            statusCode: response.status,
            responseTime: Date.now() - startTime,
            response: response.data,
          };
        } catch (webhookError: any) {
          testResult = {
            success: false,
            statusCode: webhookError.response?.status || 0,
            responseTime: Date.now() - startTime,
            error: webhookError.message,
          };
        }

        if (testResult.success) {
          try {
            const onboarding = await tenantService.getOnboardingStatus(
              params.tenantId,
            );
            if (onboarding && !onboarding.steps?.testing?.completed) {
              await tenantService.completeOnboardingStep(
                params.tenantId,
                "testing",
                getActor(auth),
              );
            }
          } catch (onboardingError) {
            logger.warn("Failed to update onboarding step", {
              error: onboardingError,
            });
          }
        }

        return ResponseBuilder.success(
          {
            webhookUrl: tenant.metadata.webhookUrl,
            testResult,
            payload: testPayload,
          },
          undefined,
          testResult.success
            ? "Webhook test successful"
            : "Webhook test failed",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to test webhook", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to test webhook",
          error.statusCode || 500,
        );
      }
    },
    testWebhookValidation,
  );
