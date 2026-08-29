import { Elysia } from "elysia";
import * as crypto from "crypto";
import axios from "axios";
import { appConfig } from "../../../../@config";
import { logger, ResponseBuilder } from "../../../../@lib";
import { requireAuth, getActor } from "../../../../middlewares/auth";
import { onlySelf } from "../../../auth/utils/access-checks";
import { TenantService } from "../../services/tenant.service";
import { signWebhookPayload } from "../../../webhook";
import {
  generateWebhookValidation,
  updateInvoiceIdKeyValidation,
  testWebhookValidation,
} from "../../validations/onboarding.validation";

export const onboardingWebhookRoutes = new Elysia()
  .use(requireAuth)
  .decorate("tenantService", new TenantService())

  /**
   * POST /tenants/:tenantId/webhook/generate
   * Generate webhook URL for tenant
   */
  .post(
    "/:tenantId/webhook/generate",
    async ({ params, body, auth, tenantService, set }) => {
      try {
        onlySelf(auth!, params.tenantId);

        logger.info("Generating webhook URL", { tenantId: params.tenantId });

        const webhookPath = crypto.randomBytes(16).toString("hex");
        const webhookSecret = crypto.randomBytes(32).toString("hex");

        const baseUrl = appConfig?.apiBaseURL || "http://localhost:3000";
        const webhookUrl = `${baseUrl}/v1/webhook/inbound/${webhookPath}`;

        const tenant = await tenantService.getTenantById(params.tenantId);
        const tenantObj = tenant.toObject();

        const invoiceIdKey =
          body?.invoiceIdKey ?? tenantObj.config?.invoiceIdKey;

        await tenantService.updateTenant(
          params.tenantId,
          {
            webhookUrl,
            webhookEnabled: true,
            config: {
              ...tenantObj.config,
              webhookUrl,
              webhookEnabled: true,
              webhookAuth: webhookSecret,
              invoiceIdKey,
            },
            metadata: {
              ...tenantObj.metadata,
              webhookUrl,
              webhookPath,
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
        onlySelf(auth!, params.tenantId);

        logger.info("Updating Invoice ID Key", { tenantId: params.tenantId });

        const tenant = await tenantService.getTenantById(params.tenantId);
        const tenantObj = tenant.toObject();

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
        onlySelf(auth!, params.tenantId);

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
        const legacySignature = crypto
          .createHmac("sha256", secret)
          .update(payloadString)
          .digest("hex");
        const now = Math.floor(Date.now() / 1000);
        const signature = signWebhookPayload(secret, now, payloadString);

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
                "X-Webhook-Key": legacySignature,
                "X-Webhook-Signature": `t=${now},v1=${signature}`,
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
