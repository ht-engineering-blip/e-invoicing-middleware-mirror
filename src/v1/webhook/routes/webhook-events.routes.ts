import { Elysia, sse, t } from "elysia";
import { logger, ResponseBuilder } from "../../../@lib";
import { requireAuth } from "../../../middlewares";
import { TenantRepository } from "../../tenants/repos/tenant.repo";
import { WebhookEventRepository } from "../repos/webhook-event.repo";
import { WebhookEventDocument } from "../models";
import { webhookBus } from "../utils/webhook-signature.helper";

export const webhookEventsRoutes = new Elysia()
  .decorate("tenantRepo", new TenantRepository())
  .decorate("webhookEventRepo", new WebhookEventRepository())

  /**
   * GET /webhook/listen/:webhookPath
   * SSE subscription to real-time inbound webhook events
   */
  .group("/listen", (app) =>
    app.use(requireAuth).all(
      "/:webhookPath",
      async function* ({ request, params, set, auth, tenantRepo }) {
        if (request.method === "OPTIONS") {
          return {};
        }

        if (!auth?.tenantId) {
          set.status = 401;
          return;
        }

        const { webhookPath } = params;
        const tenant = await tenantRepo.findByWebhookPath(webhookPath);
        if (!tenant) {
          set.status = 404;
          return;
        }

        if (tenant.tenantId !== auth.tenantId) {
          set.status = 403;
          return;
        }

        const channel = `wh:${webhookPath}`;
        const queue: WebhookEventDocument[] = [];
        let resolve: (() => void) | null = null;

        const handler = (data: WebhookEventDocument) => {
          queue.push(data);
          if (resolve) {
            resolve();
            resolve = null;
          }
        };

        webhookBus.on(channel, handler);

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
              const event = queue.shift()!;
              yield sse({
                id: event.eventId,
                event: event.eventType,
                data: event,
              });
            }
          }
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
      },
    ),
  )

  /**
   * Authenticated Webhook Events Management
   */
  .group("/events", (app) =>
    app
      .use(requireAuth)
      .get(
        "/",
        async ({ auth, query, webhookEventRepo }) => {
          const tenantId = auth?.tenantId;
          const page = Math.max(1, parseInt(query?.page || "1", 10));
          const limit = Math.min(
            100,
            Math.max(1, parseInt(query?.limit || "20", 10)),
          );
          const skip = (page - 1) * limit;

          const queryFilter: Record<string, unknown> = { $and: [] };
          const andConditions = queryFilter.$and as Array<
            Record<string, unknown>
          >;

          if (tenantId) andConditions.push({ tenantId });
          if (query?.eventType)
            andConditions.push({ eventType: query.eventType });
          if (query?.status) andConditions.push({ status: query.status });
          if (query?.irn) {
            andConditions.push({
              $or: [
                { "metadata.irn": { $regex: query.irn, $options: "i" } },
                { resourceId: { $regex: query.irn, $options: "i" } },
              ],
            });
          }
          if (query?.search) {
            andConditions.push({
              $or: [
                { eventId: { $regex: query.search, $options: "i" } },
                { eventType: { $regex: query.search, $options: "i" } },
                { "metadata.irn": { $regex: query.search, $options: "i" } },
                { resourceId: { $regex: query.search, $options: "i" } },
              ],
            });
          }
          if (andConditions.length === 0) delete queryFilter.$and;

          const [events, total] = await Promise.all([
            webhookEventRepo.find(queryFilter, skip, limit),
            webhookEventRepo.count(queryFilter),
          ]);

          const mappedEvents = events.map((e: WebhookEventDocument) => ({
            ...(typeof e.toObject === "function" ? e.toObject() : e),
            irn: e.metadata?.irn || e.resourceId,
          }));

          return ResponseBuilder.paginate(mappedEvents, total, page, limit);
        },
        {
          query: t.Optional(
            t.Object({
              page: t.Optional(t.String()),
              limit: t.Optional(t.String()),
              eventType: t.Optional(t.String()),
              status: t.Optional(t.String()),
              irn: t.Optional(t.String()),
              search: t.Optional(t.String()),
            }),
          ),
        },
      )
      .get(
        "/:eventId",
        async ({ auth, params, set, webhookEventRepo }) => {
          const event = await webhookEventRepo.findById(params.eventId);
          if (!event || (auth?.tenantId && event.tenantId !== auth.tenantId)) {
            set.status = 404;
            return ResponseBuilder.error("Webhook event not found", 404);
          }
          return ResponseBuilder.success(event);
        },
        {
          params: t.Object({
            eventId: t.String(),
          }),
        },
      ),
  );

export const webhookEventRoutes = new Elysia({ prefix: "/webhook" }).use(
  webhookEventsRoutes,
);
