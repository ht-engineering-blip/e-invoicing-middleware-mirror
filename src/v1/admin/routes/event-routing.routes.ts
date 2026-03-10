import { Elysia, t } from 'elysia';
import { requireAdmin } from '../../../middlewares/auth';
import { EventRoutingRepository } from '../repos/event-routing.repo';
import { INVOICE_EVENT_TYPES, WORKFLOW_ACTIONS } from './reference.routes';
import { onlyAdmin } from '../../auth/utils/access-checks';

const eventRoutingRepo = new EventRoutingRepository();

// Valid IDs derived from the canonical reference lists
const VALID_EVENT_IDS = INVOICE_EVENT_TYPES.map((e) => e.id) as string[];
const VALID_ACTION_IDS = WORKFLOW_ACTIONS.map((a) => a.id) as string[];

/** Single route validator (reused for add and update) */
const routeBodyValidator = t.Object({
  event: t.String({ description: 'Event type id from /admin/config/reference/events' }),
  actions: t.Array(t.String(), {
    description: 'Ordered workflow action ids from /admin/config/reference/workflow-actions',
    minItems: 1,
  }),
  enabled: t.Optional(t.Boolean({ default: true })),
  description: t.Optional(t.String()),
});

/**
 * Event Routing Routes
 * Mounted at /admin/tenants/:tenantId/event-routing
 */
export const eventRoutingRoutes = new Elysia({ prefix: '/tenants/:tenantId/event-routing' })
  .use(requireAdmin)

  /**
   * GET /admin/tenants/:tenantId/event-routing
   * Get full event routing config for a tenant.
   * Returns routes enriched with event and action metadata.
   */
  .get(
    '/',
    async ({ auth, params }) => {
      onlyAdmin(auth!, 'Admin access required');

      const config = await eventRoutingRepo.findByTenantId(params.tenantId);

      // Enrich each route with metadata from reference lists
      const routes = (config?.routes ?? []).map((route) => {
        const eventMeta = INVOICE_EVENT_TYPES.find((e) => e.id === route.event);
        const actionsMeta = route.actions.map((actionId) =>
          WORKFLOW_ACTIONS.find((a) => a.id === actionId) ?? { id: actionId, name: actionId }
        );
        return {
          routeId: route.routeId,
          event: {
            id: route.event,
            name: eventMeta?.name ?? route.event,
            category: eventMeta?.category,
            direction: eventMeta?.direction,
          },
          actions: actionsMeta,
          enabled: route.enabled,
          description: route.description ?? null,
        };
      });

      return {
        success: true,
        data: {
          tenantId: params.tenantId,
          routes,
          total: routes.length,
        },
      };
    },
    {
      params: t.Object({ tenantId: t.String() }),
      detail: {
        tags: ['Admin - Event Routing'],
        security: [{ adminKey: [] }],
        summary: 'Get event routing config',
        description: 'Get all event→action routing rules for a tenant, enriched with reference metadata.',
      },
    }
  )

  /**
   * POST /admin/tenants/:tenantId/event-routing/routes
   * Add a new route to the tenant's event routing config.
   */
  .post(
    '/routes',
    async ({ auth, params, body, set }) => {
      onlyAdmin(auth!, 'Admin access required');

      // Validate event id
      if (!VALID_EVENT_IDS.includes(body.event)) {
        set.status = 400;
        return {
          success: false,
          error: `Unknown event '${body.event}'. Check GET /admin/config/reference/events for valid ids.`,
        };
      }

      // Validate all action ids
      const unknownActions = body.actions.filter((a: string) => !VALID_ACTION_IDS.includes(a));
      if (unknownActions.length > 0) {
        set.status = 400;
        return {
          success: false,
          error: `Unknown action(s): ${unknownActions.join(', ')}. Check GET /admin/config/reference/workflow-actions for valid ids.`,
        };
      }

      const config = await eventRoutingRepo.addRoute(params.tenantId, {
        event: body.event,
        actions: body.actions,
        enabled: body.enabled ?? true,
        description: body.description,
      });

      const added = config.routes[config.routes.length - 1];

      return {
        success: true,
        message: 'Route added successfully',
        data: added,
      };
    },
    {
      params: t.Object({ tenantId: t.String() }),
      body: routeBodyValidator,
      detail: {
        tags: ['Admin - Event Routing'],
        security: [{ adminKey: [] }],
        summary: 'Add event route',
        description: 'Add a new event→actions mapping rule to the tenant routing config.',
      },
    }
  )

  /**
   * PATCH /admin/tenants/:tenantId/event-routing/routes/:routeId
   * Update an existing route (event, actions, enabled, description).
   */
  .patch(
    '/routes/:routeId',
    async ({ auth, params, body, set }) => {
      onlyAdmin(auth!, 'Admin access required');

      if (body.event && !VALID_EVENT_IDS.includes(body.event)) {
        set.status = 400;
        return { success: false, error: `Unknown event '${body.event}'.` };
      }

      if (body.actions) {
        const unknownActions = body.actions.filter((a: string) => !VALID_ACTION_IDS.includes(a));
        if (unknownActions.length > 0) {
          set.status = 400;
          return { success: false, error: `Unknown action(s): ${unknownActions.join(', ')}.` };
        }
      }

      const config = await eventRoutingRepo.updateRoute(params.tenantId, params.routeId, {
        ...(body.event !== undefined && { event: body.event }),
        ...(body.actions !== undefined && { actions: body.actions }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.description !== undefined && { description: body.description }),
      });

      if (!config) {
        set.status = 404;
        return { success: false, error: 'Route not found' };
      }

      const updated = config.routes.find((r) => r.routeId === params.routeId);

      return {
        success: true,
        message: 'Route updated',
        data: updated,
      };
    },
    {
      params: t.Object({ tenantId: t.String(), routeId: t.String() }),
      body: t.Partial(routeBodyValidator),
      detail: {
        tags: ['Admin - Event Routing'],
        security: [{ adminKey: [] }],
        summary: 'Update event route',
        description: 'Update an existing event route by routeId.',
      },
    }
  )

  /**
   * DELETE /admin/tenants/:tenantId/event-routing/routes/:routeId
   * Remove a route from the config.
   */
  .delete(
    '/routes/:routeId',
    async ({ auth, params, set }) => {
      onlyAdmin(auth!, 'Admin access required');

      const config = await eventRoutingRepo.removeRoute(params.tenantId, params.routeId);

      if (!config) {
        set.status = 404;
        return { success: false, error: 'Route not found' };
      }

      return { success: true, message: 'Route removed' };
    },
    {
      params: t.Object({ tenantId: t.String(), routeId: t.String() }),
      detail: {
        tags: ['Admin - Event Routing'],
        security: [{ adminKey: [] }],
        summary: 'Remove event route',
        description: 'Remove an event route from the tenant routing config.',
      },
    }
  )

  /**
   * PUT /admin/tenants/:tenantId/event-routing
   * Replace the entire routing config at once.
   * Useful for bulk import from frontend config builder.
   */
  .put(
    '/',
    async ({ auth, params, body, set }) => {
      onlyAdmin(auth!, 'Admin access required');

      // Validate all routes
      for (const route of body.routes) {
        if (!VALID_EVENT_IDS.includes(route.event)) {
          set.status = 400;
          return { success: false, error: `Unknown event '${route.event}'.` };
        }
        const unknown = route.actions.filter((a: string) => !VALID_ACTION_IDS.includes(a));
        if (unknown.length > 0) {
          set.status = 400;
          return { success: false, error: `Unknown action(s) in route for '${route.event}': ${unknown.join(', ')}.` };
        }
      }

      const config = await eventRoutingRepo.upsert(
        params.tenantId,
        body.routes.map((r: any, i: number) => ({
          routeId: r.routeId ?? require('crypto').randomBytes(8).toString('hex'),
          event: r.event,
          actions: r.actions,
          enabled: r.enabled ?? true,
          description: r.description,
        }))
      );

      return {
        success: true,
        message: 'Event routing config saved',
        data: {
          tenantId: params.tenantId,
          routes: config.routes,
          total: config.routes.length,
        },
      };
    },
    {
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
      }),
      detail: {
        tags: ['Admin - Event Routing'],
        security: [{ adminKey: [] }],
        summary: 'Replace full routing config',
        description: 'Replace all event routing rules at once. Ideal for saving a full config from the frontend builder.',
      },
    }
  )

  /**
   * DELETE /admin/tenants/:tenantId/event-routing
   * Clear the entire routing config for a tenant.
   */
  .delete(
    '/',
    async ({ auth, params }) => {
      onlyAdmin(auth!, 'Admin access required');
      await eventRoutingRepo.delete(params.tenantId);
      return { success: true, message: 'Event routing config cleared' };
    },
    {
      params: t.Object({ tenantId: t.String() }),
      detail: {
        tags: ['Admin - Event Routing'],
        security: [{ adminKey: [] }],
        summary: 'Clear event routing config',
        description: 'Remove all event routing rules for a tenant.',
      },
    }
  );
