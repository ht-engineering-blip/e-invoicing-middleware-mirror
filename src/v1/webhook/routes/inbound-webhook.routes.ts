import { Elysia } from "elysia";
import crypto from "crypto";
import {
  generateRandomString,
  getNestedValue,
  logger,
  ResponseBuilder,
} from "../../../@lib";
import { EventRoutingRepository } from "../../admin/repos/event-routing.repo";
import { TenantRepository } from "../../tenants/repos/tenant.repo";
import { scheduleJobChain } from "../../workflow/jobs/orchestrator";
import { OutboundInvoiceSource } from "../../workflow/models/outbound-invoice.model";
import { OutboundInvoiceRepository } from "../../workflow/repos/outbound-invoice.repo";
import {
  generateInvoiceRef,
  generateIRN,
} from "../../workflow/utils/transformer/utils";
import {
  ErpEventType,
  WebhookDeliveryStatus,
  WebhookEventType,
} from "../models";
import { WebhookEventRepository } from "../repos/webhook-event.repo";
import {
  verifyWebhookSignature,
  webhookBus,
} from "../utils/webhook-signature.helper";
import { isWebhookExpired } from "../utils/webhook-lifespan.helper";

export const inboundWebhookRoutes = new Elysia()
  .decorate("tenantRepo", new TenantRepository())
  .decorate("webhookEventRepo", new WebhookEventRepository())
  .decorate("eventRoutingRepo", new EventRoutingRepository())
  .decorate("outboundRepo", new OutboundInvoiceRepository())

  /**
   * POST /webhook/inbound/:webhookPath
   * Receive inbound data from tenants via their unique webhook URL
   */
  .post(
    "/inbound/:webhookPath",
    async ({
      params,
      body: rawBody,
      headers,
      set,
      tenantRepo,
      webhookEventRepo,
      eventRoutingRepo,
      outboundRepo,
    }) => {
      const { webhookPath } = params;
      let body: Record<string, unknown>;

      const tenant = await tenantRepo.findByWebhookPath(webhookPath);
      if (!tenant) {
        set.status = 404;
        return ResponseBuilder.error("Invalid webhook path", 404);
      }

      if (!tenant.config?.webhookEnabled) {
        set.status = 403;
        return ResponseBuilder.error(
          "Webhook is not enabled for this tenant",
          403,
        );
      }

      const expiresAt =
        tenant.metadata?.webhookExpiresAt || tenant.config?.webhookExpiresAt;
      if (isWebhookExpired(expiresAt)) {
        set.status = 401;
        return ResponseBuilder.error(
          "Webhook credentials have expired. Please regenerate your webhook credentials.",
          401,
        );
      }

      const rawText =
        typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody || {});

      const verificationResult = await verifyWebhookSignature({
        headers,
        rawBody: rawText,
        tenant,
      });

      if (!verificationResult.success) {
        set.status = verificationResult.status;
        return ResponseBuilder.error(
          verificationResult.error,
          verificationResult.status,
        );
      }

      try {
        body = (
          typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody
        ) as Record<string, unknown>;
      } catch (err) {
        set.status = 400;
        return ResponseBuilder.error("Invalid JSON payload", 400);
      }

      const eventType =
        (headers["x-event-type"] as string | undefined) ||
        (body?.event as string | undefined) ||
        (body?.eventType as string | undefined) ||
        WebhookEventType.INVOICE_RECEIVED;

      const idempotencyKey =
        (headers["x-idempotency-key"] as string | undefined) ||
        crypto
          .createHash("sha256")
          .update(`${tenant.tenantId}:${eventType}:${JSON.stringify(body)}`)
          .digest("hex");

      const existing = await webhookEventRepo.findByIdempotencyKey(
        tenant.tenantId,
        idempotencyKey,
      );

      if (existing && existing.status !== WebhookDeliveryStatus.FAILED) {
        set.status = 200;
        return ResponseBuilder.success(
          {
            eventId: existing.eventId,
            tenantId: existing.tenantId,
            eventType: existing.eventType,
            status: existing.status,
            receivedAt: existing.createdAt.toISOString(),
            idempotent: true,
          },
          undefined,
          "Webhook already received",
        );
      }

      const matchedRoutes = await eventRoutingRepo.getRoutesForEvent(
        tenant.tenantId,
        eventType,
      );
      const routedActions = matchedRoutes.flatMap((r) => r.actions);

      const config = tenant.config;
      let erpInvoiceId = "";
      const useIdKeyMap: string[] = [ErpEventType.CREDIT_NOTE_ISSUED];
      const safeEventType = eventType.replace(/\./g, "_");

      if (useIdKeyMap.includes(eventType)) {
        const idKeyMap = config?.idKeyMap as
          | Record<string, string>
          | Map<string, string>;

        let invoiceIdKey: string | undefined;
        if (idKeyMap) {
          if (typeof (idKeyMap as Map<string, string>).get === "function") {
            invoiceIdKey = (idKeyMap as Map<string, string>).get(safeEventType);
          } else {
            invoiceIdKey = (idKeyMap as Record<string, string>)[safeEventType];
          }
        }
        erpInvoiceId = String(
          invoiceIdKey ? (getNestedValue(body, invoiceIdKey) ?? "") : "",
        ).trim();
      } else {
        const invoiceIdKey = config?.invoiceIdKey ?? "invoiceId";
        erpInvoiceId = String(getNestedValue(body, invoiceIdKey) ?? "").trim();
      }

      let generatedIrn: string | undefined;
      if (erpInvoiceId) {
        const existingOutbound = await outboundRepo.findOne({
          tenantId: { _eq: tenant.tenantId },
          erpInvoiceId: { _eq: erpInvoiceId },
        });
        if (existingOutbound?.irn) {
          generatedIrn = existingOutbound.irn;
        }
      }

      if (!generatedIrn) {
        const isSelfBilled =
          body?.invoice_type_code === "385" ||
          body?.invoiceTypeCode === "385" ||
          eventType === "erp.selfbilled.issued";

        const effectiveServiceId: string = isSelfBilled
          ? "34A843BE"
          : config?.firsCredentials?.serviceId || "34A843BE";

        generatedIrn = generateIRN(
          erpInvoiceId || generateInvoiceRef(),
          effectiveServiceId,
        );
      }

      const eventId = `wh_${Date.now()}_${generateRandomString(8)}`;
      const savedEvent = await webhookEventRepo.create({
        eventId,
        tenantId: tenant.tenantId,
        eventType,
        payload: body,
        webhookUrl: `/webhook/inbound/${webhookPath}`,
        resourceId: erpInvoiceId || generatedIrn || eventId,
        resourceType: "invoice",
        status: WebhookDeliveryStatus.DELIVERED,
        deliveredAt: new Date(),
        metadata: {
          headers: {
            "x-event-type": eventType,
            "x-idempotency-key": idempotencyKey,
          },
          idempotencyKey,
          irn: generatedIrn,
          actions: routedActions,
          routedActions,
          matchedRulesCount: matchedRoutes.length,
          erpInvoiceId,
          url: `/webhook/inbound/${webhookPath}`,
        },
      });

      const channel = `wh:${webhookPath}`;
      webhookBus.emit(channel, savedEvent);

      if (routedActions.length > 0) {
        scheduleJobChain({
          webhookEventId: savedEvent.eventId,
          tenantId: tenant.tenantId,
          eventType,
          payload: body,
          actions: routedActions,
          erpInvoiceId,
          irn: generatedIrn,
          initialContext: {
            originalPayload: body,
            erpInvoiceId,
            sourceType: config?.erpSystem || "generic",
            source: OutboundInvoiceSource.WEBHOOK,
            irn: generatedIrn,
          },
        }).catch((err) =>
          logger.error("[Webhook] Failed to schedule job chain", {
            tenantId: tenant.tenantId,
            eventId,
            error: err.message,
          }),
        );
      }

      return ResponseBuilder.success(
        {
          eventId: savedEvent.eventId,
          tenantId: savedEvent.tenantId,
          eventType: savedEvent.eventType,
          status: savedEvent.status,
          irn: generatedIrn,
          receivedAt: (savedEvent.createdAt
            ? new Date(savedEvent.createdAt)
            : new Date()
          ).toISOString(),
        },
        undefined,
        "Webhook received successfully",
      );
    },
  );
