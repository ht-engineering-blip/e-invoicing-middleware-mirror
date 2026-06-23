import { WebhookEventSchema } from '../../shared/validations/models.schema';
import { t } from 'elysia';
import { addRouteExample, updateRouteExample, replaceRoutesExample } from '../examples/event-routing.examples';

export const routeBodyValidator = t.Object({
  event: t.String({ description: 'Event type id from /admin/config/reference/events', example: addRouteExample.event }),
  actions: t.Array(t.String(), {
    description: 'Ordered workflow action ids from /admin/config/reference/workflow-actions',
    minItems: 1,
  }),
  enabled: t.Optional(t.Boolean({ default: true })),
  description: t.Optional(t.String({ example: addRouteExample.description })),
}, { examples: [addRouteExample] });

export const getEventRoutingValidation = {
  params: t.Object({ tenantId: t.String() }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Union([WebhookEventSchema, t.Record(t.String(), t.Any())])),
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
    tags: ['Admin - Event Routing'],
    security: [{ adminKey: [] }],
    summary: 'Get event routing config',
    description: 'Get all event→action routing rules for a tenant, enriched with reference metadata.',
  },
};

export const addEventRouteValidation = {
  params: t.Object({ tenantId: t.String() }),
  body: routeBodyValidator,
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Union([WebhookEventSchema, t.Record(t.String(), t.Any())])),
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
    tags: ['Admin - Event Routing'],
    security: [{ adminKey: [] }],
    summary: 'Add event route',
    description: 'Add a new event→actions mapping rule to the tenant routing config.',
  },
};

export const updateEventRouteValidation = {
  params: t.Object({ tenantId: t.String(), routeId: t.String() }),
  body: t.Partial(routeBodyValidator, { examples: [updateRouteExample] }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Union([WebhookEventSchema, t.Record(t.String(), t.Any())])),
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
    tags: ['Admin - Event Routing'],
    security: [{ adminKey: [] }],
    summary: 'Update event route',
    description: 'Update an existing event route by routeId.',
  },
};

export const removeEventRouteValidation = {
  params: t.Object({ tenantId: t.String(), routeId: t.String() }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Union([WebhookEventSchema, t.Record(t.String(), t.Any())])),
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
    tags: ['Admin - Event Routing'],
    security: [{ adminKey: [] }],
    summary: 'Remove event route',
    description: 'Remove an event route from the tenant routing config.',
  },
};

export const replaceEventRoutingValidation = {
  params: t.Object({ tenantId: t.String() }),
  body: t.Object({
    routes: t.Array(
      t.Object({
        routeId: t.Optional(t.String()),
        event: t.String(),
        actions: t.Array(t.String(), { minItems: 1 }),
        enabled: t.Optional(t.Boolean()),
        description: t.Optional(t.String()),
      })
    ),
  }, { examples: [replaceRoutesExample] }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Union([WebhookEventSchema, t.Record(t.String(), t.Any())])),
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
    tags: ['Admin - Event Routing'],
    security: [{ adminKey: [] }],
    summary: 'Replace full routing config',
    description: 'Replace all event routing rules at once. Ideal for saving a full config from the frontend builder.',
  },
};

export const clearEventRoutingValidation = {
  params: t.Object({ tenantId: t.String() }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Union([WebhookEventSchema, t.Record(t.String(), t.Any())])),
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
    tags: ['Admin - Event Routing'],
    security: [{ adminKey: [] }],
    summary: 'Clear event routing config',
    description: 'Remove all event routing rules for a tenant.',
  },
};
