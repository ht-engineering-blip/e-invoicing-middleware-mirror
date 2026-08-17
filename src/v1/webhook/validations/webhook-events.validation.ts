import { WebhookEventSchema } from '../../shared/validations/models.schema';
import { t } from "elysia";

export const listWebhookEventsValidation = {
  query: t.Object({
    page: t.Optional(t.String()),
    limit: t.Optional(t.String()),
    tenantId: t.Optional(t.String()),
    eventType: t.Optional(t.String()),
    status: t.Optional(t.String()),
    irn: t.Optional(t.String()),
    search: t.Optional(t.String()),
    from: t.Optional(t.String()),
    to: t.Optional(t.String()),
  }),
  
  detail: {
    tags: ["Webhook Events"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "List Webhook Events",
    description:
      "List webhook events for the authenticated tenant. Supports filtering by eventType, status, IRN (partial match), search query (across IRN, eventId, eventType), and date range.",
  },
};

export const getWebhookEventValidation = {
  params: t.Object({ eventId: t.String() }),
  
  detail: {
    tags: ["Webhook Events"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Get Webhook Event",
    description:
      "Get a single webhook event by its eventId. Includes full jobErrors history and delivery attempts.",
  },
};
