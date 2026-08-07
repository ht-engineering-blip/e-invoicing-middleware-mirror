// Webhook module routes
import { cors } from "@elysiajs/cors";
import crypto from "crypto";
import { Elysia, sse, t } from "elysia";
import { EventEmitter } from "events";
import { generateRandomString, getNestedValue, logger } from "../../@lib";
import { requireAuth } from "../../middlewares";
import { appConfig } from "../../@config/app";
import { EventRoutingRepository } from "../admin/repos/event-routing.repo";
import { TenantRepository } from "../tenants/repos/tenant.repo";
import { scheduleJobChain } from "../workflow/jobs/orchestrator";
import { OutboundInvoiceSource } from "../workflow/models/outbound-invoice.model";
import { OutboundInvoiceRepository } from "../workflow/repos/outbound-invoice.repo";
import {
  generateInvoiceRef,
  generateIRN,
} from "../workflow/utils/transformer/utils";
import {
  ErpEventType,
  WebhookDeliveryStatus,
  WebhookEventType,
} from "./models";
import { WebhookEventRepository } from "./repos/webhook-event.repo";
import { WebhookNonceRepository } from "./repos/webhook-nonce.repo";

const tenantRepo = new TenantRepository();
const webhookEventRepo = new WebhookEventRepository();
const eventRoutingRepo = new EventRoutingRepository();
const outboundRepo = new OutboundInvoiceRepository();
const webhookNonceRepo = new WebhookNonceRepository();

/**
 * In-memory event bus for real-time SSE streaming per webhook path.
 */
const webhookBus = new EventEmitter();
webhookBus.setMaxListeners(0);

/**
 * Signs the webhook payload using the HMAC-SHA256 scheme.
 */
export function signWebhookPayload(
  secret: string,
  timestamp: string | number,
  payload: string,
): string {
  const dataToSign = `${timestamp}.${payload}`;
  return crypto.createHmac("sha256", secret).update(dataToSign).digest("hex");
}

/**
 * Verifies the inbound webhook signature.
 * Returns an object indicating success or failure.
 */
export async function verifyWebhookSignature({
  headers,
  rawBody,
  tenant,
}: {
  headers: Record<string, string | undefined>;
  rawBody: string;
  tenant: {
    tenantId: string;
    config?: { webhookAuth?: string };
    metadata?: { webhookSecretHash?: string };
  };
}): Promise<
  { success: true } | { success: false; status: number; error: string }
> {
  const webhookKey = headers["x-webhook-key"];
  const webhookKeyHash = tenant.metadata?.webhookSecretHash;

  if (webhookKeyHash && !webhookKey) {
    return {
      success: false,
      status: 401,
      error: "Missing X-Webhook-Key header",
    };
  }

  if (!webhookKeyHash) {
    // If no secret hash is configured, allow for legacy/unconfigured support
    return { success: true };
  }

  // Check if the header is formatted as a secure signature (t=...,v1=...)
  const isSecureFormat =
    webhookKey!.includes("t=") && webhookKey!.includes("v1=");

  if (isSecureFormat) {
    // 1. Secure Signature Flow with Timestamp and Replay Protection
    const parts = webhookKey!.split(",");
    let tStr = "";
    let v1 = "";
    for (const part of parts) {
      const [key, val] = part.split("=");
      if (key === "t") tStr = val;
      if (key === "v1") v1 = val;
    }

    if (!tStr || !v1) {
      return {
        success: false,
        status: 401,
        error: "Invalid X-Webhook-Key format (missing t or v1)",
      };
    }

    // Check timestamp window: reject if |now - t| > 300 seconds
    const t = parseInt(tStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(t) || Math.abs(now - t) > 300) {
      return {
        success: false,
        status: 401,
        error: "Webhook request expired or timestamp invalid",
      };
    }

    // Check for replay (nonce deduplication)
    const isReplay = await webhookNonceRepo.findOne({
      tenantId: tenant.tenantId,
      t,
      v1,
    });
    if (isReplay) {
      return {
        success: false,
        status: 401,
        error: "Duplicate webhook request detected (replay prevention)",
      };
    }

    // Retrieve plaintext secret to use as the HMAC signing key
    const secret = tenant.config?.webhookAuth;
    if (!secret) {
      return {
        success: false,
        status: 401,
        error: "Webhook secret not configured for this tenant in config",
      };
    }

    // Compute expected HMAC-SHA256 signature
    const expectedSignature = signWebhookPayload(secret, tStr, rawBody);

    // Timing-safe comparison
    let signatureMatches = false;
    try {
      signatureMatches = crypto.timingSafeEqual(
        Buffer.from(v1, "hex"),
        Buffer.from(expectedSignature, "hex"),
      );
    } catch {
      signatureMatches = false;
    }

    if (!signatureMatches) {
      return {
        success: false,
        status: 401,
        error: "Invalid webhook signature",
      };
    }

    // Persist nonce to prevent replays
    await webhookNonceRepo.create({
      tenantId: tenant.tenantId,
      t,
      v1,
    });
  } else {
    // 2. Legacy Static Secret Flow (Fallback for compatibility with existing clients)
    const hashedKey = crypto
      .createHash("sha256")
      .update(webhookKey!)
      .digest("hex");

    let matches = false;
    try {
      matches = crypto.timingSafeEqual(
        Buffer.from(hashedKey, "hex"),
        Buffer.from(webhookKeyHash, "hex"),
      );
    } catch {
      matches = false;
    }

    if (!matches) {
      return {
        success: false,
        status: 401,
        error: "Invalid webhook key",
      };
    }
  }

  return { success: true };
}

export const webhookRoutes = new Elysia({
  prefix: "/webhook",
})
  .use(
    cors({
      origin: (request) => {
        const origin = request.headers.get("origin");
        if (!origin) return false;
        const allowedOrigins = [
          appConfig?.webAppURL,
          "http://localhost:3000",
          "http://localhost:3001",
          "http://localhost:3002",
        ].filter(Boolean);
        return allowedOrigins.includes(origin);
      },
    }),
  )

  /**
   * GET /webhook/listen/:webhookPath
   * SSE endpoint - subscribe to real-time inbound webhook events.
   * Clients connect here to listen for data as it arrives on the webhook.
   */
  .group("/listen", (app) =>
    app.use(requireAuth).all(
      "/:webhookPath",
      async function* ({ request, params, set, auth }) {
        if (request.method == "OPTIONS") {
          return {};
        }

        if (!auth?.tenantId) {
          set.status = 401;
          return;
        }

        const { webhookPath } = params;

        // Validate tenant
        const tenant = await tenantRepo.findByWebhookPath(webhookPath);
        if (!tenant) {
          set.status = 404;
          return;
        }

        // Scope decryption to invoices owned by the authenticated tenant
        if (tenant.tenantId !== auth.tenantId) {
          set.status = 403;
          return;
        }

        const channel = `wh:${webhookPath}`;
        const queue: any[] = [];
        let resolve: (() => void) | null = null;

        const handler = (data: any) => {
          console.log({ data });
          queue.push(data);
          if (resolve) {
            resolve();
            resolve = null;
          }
        };

        webhookBus.on(channel, handler);

        // Send initial connection event
        yield sse({
          event: "connected",
          data: {
            tenantId: tenant.tenantId,
            webhookPath,
            connectedAt: new Date().toISOString(),
            message: "Listening for inbound webhook events",
          },
        });

        try {
          while (true) {
            if (queue.length === 0) {
              await new Promise<void>((r) => (resolve = r));
            }
            while (queue.length > 0) {
              const event = queue.shift();
              yield sse({
                id: event.eventId,
                event: event.eventType,
                data: event,
              });
            }
          }
        } catch (e) {
          console.log({ e });
        } finally {
          webhookBus.off(channel, handler);
          logger.info("SSE client disconnected", {
            webhookPath,
            tenantId: tenant.tenantId,
          });
        }
      },
      {
        params: t.Object({
          webhookPath: t.String(),
        }),
        detail: {
          tags: ["Webhook - Inbound"],
          summary: "Listen for inbound webhook events",
          description:
            "Connect to receive real-time (SSE) inbound webhook data as it arrives for this tenant.",
        },
      },
    ),
  )

  /**
   * POST /webhook/inbound/:webhookPath
   * Receive inbound data from tenants via their unique webhook URL
   * No auth middleware - verified via webhookPath + signature
   */
  .post(
    "/inbound/:webhookPath",
    async ({ params, body: rawBody, headers, set }) => {
      const { webhookPath } = params;
      let body: any;

      // 1. Look up tenant by webhook path
      const tenant = await tenantRepo.findByWebhookPath(webhookPath);
      if (!tenant) {
        set.status = 404;
        return {
          success: false,
          error: "Invalid webhook path",
        };
      }

      // 2. Verify webhook is enabled
      if (!tenant.config?.webhookEnabled) {
        set.status = 403;
        return {
          success: false,
          error: "Webhook is not enabled for this tenant",
        };
      }

      // 3. Verify signature via helper function
      const verificationResult = await verifyWebhookSignature({
        headers,
        rawBody: String(rawBody || ""),
        tenant,
      });

      if (!verificationResult.success) {
        set.status = verificationResult.status;
        return {
          success: false,
          error: verificationResult.error,
        };
      }

      // Parse JSON body now that signature is verified
      try {
        body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
      } catch (err) {
        set.status = 400;
        return {
          success: false,
          error: "Invalid JSON payload",
        };
      }

      // 4. Determine event type from payload or headers
      const eventType =
        headers["x-event-type"] ||
        body?.event ||
        body?.eventType ||
        WebhookEventType.INVOICE_RECEIVED;

      // 5. Resolve idempotency key
      //    Prefer X-Idempotency-Key header; fall back to a content hash so
      //    identical payloads sent without a key are also de-duplicated.
      const idempotencyKey =
        headers["x-idempotency-key"] ||
        crypto
          .createHash("sha256")
          .update(`${tenant.tenantId}:${eventType}:${JSON.stringify(body)}`)
          .digest("hex");

      // 6. Check for an existing event with this idempotency key
      const existing = await webhookEventRepo.findByIdempotencyKey(
        tenant.tenantId,
        idempotencyKey,
      );

      if (existing) {
        if (existing.status !== WebhookDeliveryStatus.FAILED) {
          // Already processed successfully (DELIVERED / PENDING / RETRY) — return cached response
          set.status = 200;
          return {
            success: true,
            message: "Webhook already received",
            data: {
              eventId: existing.eventId,
              tenantId: existing.tenantId,
              eventType: existing.eventType,
              status: existing.status,
              receivedAt: existing.createdAt.toISOString(),
              idempotent: true,
            },
          };
        }
        // Status is FAILED — fall through to reprocess
        logger.info("Reprocessing failed webhook event", {
          tenantId: tenant.tenantId,
          existingEventId: existing.eventId,
          idempotencyKey,
        });
      }

      // 6. Resolve event routing — find actions mapped for this event type
      const matchedRoutes = await eventRoutingRepo.getRoutesForEvent(
        tenant.tenantId,
        eventType,
      );

      const routedActions = matchedRoutes.flatMap((r) => r.actions);

      // 7. Extract ERP invoice ID using the configured key path (dot-notation)
      const config = tenant.config;
      let erpInvoiceId = "";

      const useIdKeyMap = [ErpEventType.CREDIT_NOTE_ISSUED];

      const safeEventType = eventType.replace(/\./g, "_");
      if (useIdKeyMap.includes(eventType)) {
        const idKeyMap: any = config?.idKeyMap;
        let invoiceIdKey;
        if (idKeyMap) {
          if (typeof idKeyMap.get === "function") {
            invoiceIdKey = idKeyMap.get(safeEventType);
          } else {
            invoiceIdKey = idKeyMap[safeEventType];
          }
        }

        erpInvoiceId = String(getNestedValue(body, invoiceIdKey) ?? "").trim();
      } else {
        const invoiceIdKey = config?.invoiceIdKey ?? "invoiceId";
        erpInvoiceId = String(getNestedValue(body, invoiceIdKey) ?? "").trim();
      }

      if (!erpInvoiceId) erpInvoiceId = generateRandomString(10);

      // 8. Upsert OutboundInvoice — create on first event, reuse on updates
      let irn: string | undefined;
      if (erpInvoiceId) {
        const invoiceRef = generateInvoiceRef(undefined, erpInvoiceId);
        const generatedIrn = generateIRN(
          invoiceRef,
          tenant.config?.firsCredentials?.serviceId,
          new Date(),
        );

        const { doc: invoice, created } =
          await outboundRepo.findOrCreateByErpInvoiceId(
            tenant.tenantId,
            erpInvoiceId,
            {
              irn: generatedIrn,
              erpSystem: tenant.config?.erpSystem ?? "UNKNOWN",
              source: OutboundInvoiceSource.WEBHOOK,
              createdBy: tenant.tenantId,
              metadata: {},
            },
          );

        irn = invoice.irn;
        logger.info(
          `[Webhook] Invoice ${created ? "created" : "found"} for erpInvoiceId`,
          {
            tenantId: tenant.tenantId,
            erpInvoiceId,
            irn,
            created,
          },
        );
      } else {
        //TODO:: Return Invoice ID Key Error
      }

      // 9. Store the webhook event
      const eventId = `wh_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;

      try {
        await webhookEventRepo.create({
          tenantId: tenant.tenantId,
          eventId,
          eventType,
          payload: body,
          resourceId: irn ?? body?.irn ?? body?.resourceId ?? eventId,
          resourceType: body?.resourceType || "invoice",
          webhookUrl: tenant.metadata?.webhookUrl || "",
          status: WebhookDeliveryStatus.DELIVERED,
          deliveryAttempts: [
            {
              attemptNumber: 1,
              timestamp: new Date(),
              httpStatus: 200,
              duration: 0,
            },
          ],
          maxRetries: 0,
          deliveredAt: new Date(),
          jobErrors: [],
          metadata: {
            source: "inbound",
            matchedRoutes,
            webhookPath,
            idempotencyKey,
            irn,
            erpInvoiceId,
            receivedAt: new Date().toISOString(),
            headers: {
              "content-type": headers["content-type"],
              "x-event-type": headers["x-event-type"],
              "user-agent": headers["user-agent"],
            },
          },
        } as any);

        // 10. Link webhook event to the invoice record
        if (irn) await outboundRepo.addWebhookEvent(irn, eventId);

        logger.info("Inbound webhook received", {
          tenantId: tenant.tenantId,
          eventId,
          eventType,
          erpInvoiceId,
          irn,
        });

        // 11. Schedule background job chain (fire-and-forget)
        let jobChainId: string | undefined;
        if (routedActions.length > 0) {
          scheduleJobChain({
            webhookEventId: eventId,
            tenantId: tenant.tenantId,
            eventType,
            payload: body,
            actions: matchedRoutes.flatMap((r) => r.actions),
            routeId: matchedRoutes[0]?.routeId,
            erpInvoiceId,
            irn,
          })
            .then((id) => (jobChainId = id))
            .catch((err) =>
              logger.error("Failed to schedule job chain", {
                eventId,
                tenantId: tenant.tenantId,
                error: err.message,
              }),
            );
        }

        // 12. Push to SSE listeners on this webhookPath
        webhookBus.emit(`wh:${webhookPath}`, {
          eventId,
          tenantId: tenant.tenantId,
          eventType,
          payload: body,
          receivedAt: new Date().toISOString(),
          irn,
          erpInvoiceId,
          routing: {
            matchedRoutes: matchedRoutes.length,
            actions: routedActions,
          },
        });

        return {
          success: true,
          message: "Webhook received successfully",
          data: {
            eventId,
            tenantId: tenant.tenantId,
            eventType,
            irn,
            erpInvoiceId,
            receivedAt: new Date().toISOString(),
            routing: {
              matchedRoutes: matchedRoutes.length,
              actions: routedActions,
              jobChainId: jobChainId ?? null,
            },
          },
        };
      } catch (error: any) {
        logger.error("Failed to process inbound webhook", {
          webhookPath,
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to process webhook",
        };
      }
    },
    {
      parse: "text",
      params: t.Object({
        webhookPath: t.String(),
      }),
      detail: {
        tags: ["Webhook - Inbound"],
        summary: "Receive inbound webhook",
        description: "Endpoint for tenants to send data to the platform.",
      },
    },
  );
