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
    from: t.Optional(t.String()),
    to: t.Optional(t.String()),
  }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Union([WebhookEventSchema, t.Array(WebhookEventSchema), t.Record(t.String(), t.Any())])),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ["Webhook Events"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "List Webhook Events",
    description:
      "List webhook events for the authenticated tenant. Supports filtering by eventType, status, IRN, and date range.",
  },
};

export const getWebhookEventValidation = {
  params: t.Object({ eventId: t.String() }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Union([WebhookEventSchema, t.Array(WebhookEventSchema), t.Record(t.String(), t.Any())])),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ["Webhook Events"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Get Webhook Event",
    description:
      "Get a single webhook event by its eventId. Includes full jobErrors history and delivery attempts.",
  },
};
