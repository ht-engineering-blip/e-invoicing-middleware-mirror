import { Elysia } from "elysia";
import { requireAuth } from "../../../middlewares/auth";
import { WebhookEventRepository } from "../repos/webhook-event.repo";
import { ResponseBuilder } from "../../../@lib";
import {
  listWebhookEventsValidation,
  getWebhookEventValidation,
} from "../validations/webhook-events.validation";

export const webhookEventRoutes = new Elysia({ prefix: "/webhook/events" })
  .use(requireAuth)
  .decorate("webhookEventRepo", new WebhookEventRepository())

  /**
   * GET /webhook/events
   * List webhook events for the authenticated tenant.
   * Admins may optionally filter by tenantId.
   */
  .get(
    "/",
    async ({ query, auth, webhookEventRepo }) => {
      try {
        const page = Math.max(1, parseInt(query.page || "1"));
        const limit = Math.min(parseInt(query.limit || "20"), 100);
        const offset = (page - 1) * limit;

        const conditions: any[] = [];

        // Tenants can only see their own events; admins can see all or filter by tenantId
        if (!auth!.isAdmin) {
          conditions.push({ tenantId: auth!.tenantId });
        } else if (query.tenantId) {
          conditions.push({ tenantId: query.tenantId });
        }

        if (query.eventType) {
          conditions.push({ eventType: query.eventType });
        }
        if (query.status) {
          conditions.push({ status: query.status });
        }

        if (query.irn && query.irn.trim()) {
          const escapedIrn = query.irn
            .trim()
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const irnRegex = { $regex: escapedIrn, $options: "i" };
          conditions.push({
            $or: [
              { "metadata.irn": irnRegex },
              { resourceId: irnRegex },
              { "payload.irn": irnRegex },
            ],
          });
        }

        if (query.search && query.search.trim()) {
          const escapedSearch = query.search
            .trim()
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const searchRegex = { $regex: escapedSearch, $options: "i" };
          conditions.push({
            $or: [
              { eventId: searchRegex },
              { eventType: searchRegex },
              { "metadata.irn": searchRegex },
              { resourceId: searchRegex },
              { "payload.irn": searchRegex },
            ],
          });
        }

        if (query.from || query.to) {
          const createdAt: any = {};
          if (query.from) createdAt.$gte = new Date(query.from);
          if (query.to) createdAt.$lte = new Date(query.to);
          conditions.push({ createdAt });
        }

        let mongoQuery: any = {};
        if (conditions.length === 1) {
          mongoQuery = conditions[0];
        } else if (conditions.length > 1) {
          mongoQuery = { $and: conditions };
        }

        const [data, total] = await Promise.all([
          webhookEventRepo.find(mongoQuery, offset, limit),
          webhookEventRepo.count(mongoQuery),
        ]);

        const formatted = data.map((ev) => ({
          eventId: ev.eventId,
          tenantId: ev.tenantId,
          eventType: ev.eventType,
          status: ev.status,
          resourceId: ev.resourceId,
          resourceType: ev.resourceType,
          irn: ev.metadata?.irn ?? ev.resourceId ?? ev.payload?.irn,
          erpInvoiceId: ev.metadata?.erpInvoiceId ?? ev.payload?.erpInvoiceId,
          jobErrorCount: ev.jobErrors?.length ?? 0,
          createdAt: ev.createdAt,
          updatedAt: ev.updatedAt,
        }));

        return ResponseBuilder.paginate(formatted, total, page, limit);
      } catch (error: any) {
        return ResponseBuilder.error(
          error.message || "Failed to fetch webhook events",
          error.statusCode || 500,
        );
      }
    },
    listWebhookEventsValidation,
  )

  /**
   * GET /webhook/events/:eventId
   * Get a single webhook event by its eventId, including full jobErrors history.
   */
  .get(
    "/:eventId",
    async ({ params, auth, webhookEventRepo }) => {
      try {
        const tenantId = auth!.isAdmin ? undefined : auth!.tenantId;
        const ev = await webhookEventRepo.findByEventId(
          params.eventId,
          tenantId,
        );

        if (!ev) {
          return ResponseBuilder.error("Webhook event not found", 404);
        }

        return ResponseBuilder.success({
          eventId: ev.eventId,
          tenantId: ev.tenantId,
          eventType: ev.eventType,
          status: ev.status,
          resourceId: ev.resourceId,
          resourceType: ev.resourceType,
          webhookUrl: ev.webhookUrl,
          payload: ev.payload,
          metadata: ev.metadata,
          irn: ev.metadata?.irn ?? ev.resourceId ?? ev.payload?.irn,
          erpInvoiceId: ev.metadata?.erpInvoiceId ?? ev.payload?.erpInvoiceId,
          jobErrors: ev.jobErrors ?? [],
          deliveryAttempts: ev.deliveryAttempts ?? [],
          maxRetries: ev.maxRetries,
          failureReason: ev.failureReason,
          deliveredAt: ev.deliveredAt,
          failedAt: ev.failedAt,
          nextRetryAt: ev.nextRetryAt,
          createdAt: ev.createdAt,
          updatedAt: ev.updatedAt,
        });
      } catch (error: any) {
        return ResponseBuilder.error(
          error.message || "Failed to fetch webhook event",
          error.statusCode || 500,
        );
      }
    },
    getWebhookEventValidation,
  );
