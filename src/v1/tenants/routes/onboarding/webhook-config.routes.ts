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

function buildIntegrationExamples(
  webhookUrl: string | null,
  webhookSecret?: string | null,
) {
  const url =
    webhookUrl ||
    "https://api.yourdomain.com/v1/webhook/inbound/<YOUR_WEBHOOK_PATH>";
  const secret = webhookSecret || "<YOUR_WEBHOOK_SECRET>";

  return {
    modernHmac: {
      description:
        "Modern Dynamic HMAC-SHA256 Signature (Recommended for custom codebases)",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Key": "t={UNIX_TIMESTAMP},v1={HMAC_SHA256_HEX}",
      },
      curlExample: `TIMESTAMP=$(date +%s)\nSIGNATURE=$(printf "$TIMESTAMP.{\\"event\\":\\"invoice.received\\",\\"invoiceId\\":\\"INV-1001\\"}" | openssl dgst -sha256 -hmac "${secret}" | sed 's/^.* //')\ncurl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Webhook-Key: t=$TIMESTAMP,v1=$SIGNATURE" \\\n  -d '{"event":"invoice.received","invoiceId":"INV-1001","totalAmount":150000}'`,
    },
    legacyStaticHeader: {
      description:
        "Legacy Static Secret Header (For standard ERPs and off-the-shelf webhook plugins)",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
      },
      curlExample: `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Webhook-Secret: ${secret}" \\\n  -d '{"invoiceId":"INV-1001","totalAmount":150000}'`,
    },
    legacyBearerAuth: {
      description: "Authorization Bearer Token Header",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      curlExample: `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${secret}" \\\n  -d '{"invoiceId":"INV-1001","totalAmount":150000}'`,
    },
    legacyQueryParam: {
      description:
        "URL Query Parameter (For systems that cannot modify HTTP headers)",
      url: `${url}?secret=${secret}`,
      curlExample: `curl -X POST "${url}?secret=${secret}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"invoiceId":"INV-1001","totalAmount":150000}'`,
    },
    legacyXmlTally: {
      description: "Legacy Tally / XML Payload",
      headers: {
        "Content-Type": "application/xml",
        "X-Webhook-Secret": secret,
      },
      curlExample: `curl -X POST "${url}" \\\n  -H "Content-Type: application/xml" \\\n  -H "X-Webhook-Secret: ${secret}" \\\n  -d '<ENVELOPE><BODY><DATA><TALLYMESSAGE><VOUCHER><VOUCHERNUMBER>INV-1001</VOUCHERNUMBER><AMOUNT>150000</AMOUNT></VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>'`,
    },
  };
}

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
        const config = tenantObj.config;
        const metadata = tenantObj.metadata;

        const webhookUrl = metadata?.webhookUrl || config?.webhookUrl || null;
        const webhookPath = metadata?.webhookPath || null;
        const webhookEnabled = Boolean(tenantObj.config?.webhookEnabled);
        const invoiceIdKey = config?.invoiceIdKey || "invoiceId";
        const webhookAuthMode =
          config?.webhookAuthMode || metadata?.webhookAuthMode || "auto";
        const defaultEventType = config?.defaultEventType;
        const lifespan = metadata?.webhookLifespan || config?.webhookLifespan;
        const expiresAtRaw =
          metadata?.webhookExpiresAt || config?.webhookExpiresAt || null;

        const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
        const expired = expiresAt ? isWebhookExpired(expiresAt) : false;
        const hasSecret = Boolean(
          metadata?.webhookSecretHash || config?.webhookAuth,
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

        const integrationExamples = buildIntegrationExamples(
          webhookUrl,
          config?.webhookAuth ? "••••••••" : undefined,
        );

        return ResponseBuilder.success({
          tenantId: params.tenantId,
          configured: Boolean(webhookUrl && hasSecret),
          webhookUrl,
          webhookPath,
          webhookEnabled,
          webhookAuthMode,
          defaultEventType,
          invoiceIdKey,
          lifespan,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          isExpired: expired,
          hasSecret,
          remainingDays,
          integrationExamples,
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
        const config = tenantObj.config;
        const metadata = tenantObj.metadata;

        const webhookUrl = metadata?.webhookUrl || config?.webhookUrl;
        const webhookPath = metadata?.webhookPath || config?.webhookPath;
        const webhookEnabled = Boolean(config?.webhookEnabled);
        const invoiceIdKey = config?.invoiceIdKey || "invoiceId";
        const webhookAuthMode =
          config?.webhookAuthMode || metadata?.webhookAuthMode;
        const defaultEventType = config?.defaultEventType;
        const lifespan = metadata?.webhookLifespan || config?.webhookLifespan;
        const expiresAtRaw =
          metadata?.webhookExpiresAt || config?.webhookExpiresAt;

        const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
        const expired = expiresAt ? isWebhookExpired(expiresAt) : false;
        const hasSecret = Boolean(
          metadata?.webhookSecretHash || config?.webhookAuth,
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

        const integrationExamples = buildIntegrationExamples(
          webhookUrl,
          tenantObj.config?.webhookAuth ? "••••••••" : undefined,
        );

        return ResponseBuilder.success({
          tenantId: params.tenantId,
          configured: Boolean(webhookUrl && hasSecret),
          webhookUrl,
          webhookPath,
          webhookEnabled,
          webhookAuthMode,
          defaultEventType,
          invoiceIdKey,
          lifespan,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          isExpired: expired,
          hasSecret,
          remainingDays,
          integrationExamples,
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
        const webhookAuthMode =
          body?.webhookAuthMode ?? tenantObj.config?.webhookAuthMode ?? "auto";
        const defaultEventType =
          body?.defaultEventType ??
          tenantObj.config?.defaultEventType ??
          "invoice.received";

        const { lifespan, expiresAt } = calculateWebhookExpiry(body?.lifespan);

        await tenantService.updateTenant(
          params.tenantId,
          {
            webhookUrl,
            webhookEnabled: true,
            webhookExpiresAt: expiresAt,
            webhookLifespan: lifespan,
            webhookAuthMode,
            defaultEventType,
            config: {
              ...tenantObj.config,
              webhookUrl,
              webhookEnabled: true,
              webhookAuth: webhookSecret,
              webhookAuthMode,
              defaultEventType,
              webhookExpiresAt: expiresAt,
              webhookLifespan: lifespan,
              invoiceIdKey,
            },
            metadata: {
              ...tenantObj.metadata,
              webhookUrl,
              webhookPath,
              webhookAuthMode,
              defaultEventType,
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

        const integrationExamples = buildIntegrationExamples(
          webhookUrl,
          webhookSecret,
        );

        return ResponseBuilder.success(
          {
            webhookUrl,
            webhookSecret,
            webhookPath,
            webhookAuthMode,
            defaultEventType,
            lifespan,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            invoiceIdKey: invoiceIdKey ?? null,
            integrationExamples,
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
   * Test webhook connectivity with configurable authentication strategy
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

        const testPayload: Record<string, any> = body?.testPayload
          ? { ...body.testPayload }
          : {
              event: "webhook.test",
              tenantId: params.tenantId,
              timestamp: new Date().toISOString(),
              data: {
                message: "This is a test webhook from E-Invoicing Platform",
                irn: "TEST-IRN-" + Date.now(),
              },
            };

        const authStrategy = body?.authStrategy || "hmac";

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Webhook-Event": "webhook.test",
        };
        let targetUrl = tenant.metadata.webhookUrl;

        if (authStrategy === "static_secret") {
          headers["X-Webhook-Secret"] = secret;
        } else if (authStrategy === "bearer") {
          headers["Authorization"] = `Bearer ${secret}`;
        } else if (authStrategy === "query") {
          const separator = targetUrl.includes("?") ? "&" : "?";
          targetUrl = `${targetUrl}${separator}secret=${encodeURIComponent(secret)}`;
        } else if (authStrategy === "body") {
          testPayload.secret = secret;
        } else if (authStrategy === "secret_url") {
          // No special headers or secrets required
        } else {
          // Default: dynamic HMAC-SHA256
          const payloadString = JSON.stringify(testPayload);
          const now = Math.floor(Date.now() / 1000);
          const signature = signWebhookPayload(secret, now, payloadString);
          const secureKey = `t=${now},v1=${signature}`;
          headers["X-Webhook-Key"] = secureKey;
          headers["X-Webhook-Signature"] = secureKey;
        }

        let testResult: any = {
          success: false,
          statusCode: 0,
          responseTime: 0,
          error: null,
        };

        const startTime = Date.now();

        try {
          const response = await axios.post(targetUrl, testPayload, {
            headers,
            timeout: 10000,
          });

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
            authStrategy,
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
