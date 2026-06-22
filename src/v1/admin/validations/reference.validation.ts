import { t } from 'elysia';

export const listEventsValidation = {
  query: t.Object({
    category: t.Optional(
      t.UnionEnum(['all', 'lifecycle', 'payment', 'system', 'erp', 'reporting'])
    ),
    direction: t.Optional(t.UnionEnum(['all', 'inbound', 'outbound', 'both'])),
  }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
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
    tags: ['Admin - Reference Data'],
    summary: 'List invoice event types',
    description:
      'Returns all available invoice event types including platform lifecycle events and ERP-originating events. Supports filtering by category or direction.',
  },
};

export const listWorkflowActionsValidation = {
  query: t.Object({
    category: t.Optional(
      t.UnionEnum(['all', 'outbound', 'inbound', 'reporting'])
    ),
  }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
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
    tags: ['Admin - Reference Data'],
    summary: 'List workflow actions',
    description:
      'Returns all available workflow actions in execution order. Use these to build action mapping and sequencing in the frontend.',
  },
};
