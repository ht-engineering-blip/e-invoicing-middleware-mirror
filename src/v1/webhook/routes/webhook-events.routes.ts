import { Elysia, t } from 'elysia';
import { requireAuth } from '../../../middlewares/auth';
import { WebhookEventRepository } from '../repos/webhook-event.repo';
import { WebhookDeliveryStatus } from '../models/webhook-event.model';

export const webhookEventRoutes = new Elysia({ prefix: '/webhook/events' })
  .use(requireAuth)
  .decorate('webhookEventRepo', new WebhookEventRepository())

  /**
   * GET /webhook/events
   * List webhook events for the authenticated tenant.
   * Admins may optionally filter by tenantId.
   */
  .get(
    '/',
    async ({ query, auth, webhookEventRepo }) => {
      try {
        const page = Math.max(1, parseInt(query.page || '1'));
        const limit = Math.min(parseInt(query.limit || '20'), 100);
        const offset = (page - 1) * limit;

        const mongoQuery: any = {};

        // Tenants can only see their own events; admins can see all or filter by tenantId
        if (!auth!.isAdmin) {
          mongoQuery.tenantId = auth!.tenantId;
        } else if (query.tenantId) {
          mongoQuery.tenantId = query.tenantId;
        }

        if (query.eventType) mongoQuery.eventType = query.eventType;
        if (query.status) mongoQuery.status = query.status;
        if (query.irn) mongoQuery.resourceId = query.irn;

        if (query.from || query.to) {
          mongoQuery.createdAt = {};
          if (query.from) mongoQuery.createdAt.$gte = new Date(query.from);
          if (query.to) mongoQuery.createdAt.$lte = new Date(query.to);
        }

        const [data, total] = await Promise.all([
          webhookEventRepo.find(mongoQuery, offset, limit),
          webhookEventRepo.count(mongoQuery),
        ]);

        return {
          success: true,
          data: data.map((ev) => ({
            eventId: ev.eventId,
            tenantId: ev.tenantId,
            eventType: ev.eventType,
            status: ev.status,
            resourceId: ev.resourceId,
            resourceType: ev.resourceType,
            irn: ev.metadata?.irn,
            erpInvoiceId: ev.metadata?.erpInvoiceId,
            jobErrorCount: ev.jobErrors?.length ?? 0,
            createdAt: ev.createdAt,
            updatedAt: ev.updatedAt,
          })),
          meta: {
            total,
            page,
            limit,
            pages: Math.ceil(total / limit),
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message || 'Failed to fetch webhook events', statusCode: error.statusCode || 500 };
      }
    },
    {
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
      detail: {
        tags: ['Webhook Events'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'List Webhook Events',
        description: 'List webhook events for the authenticated tenant. Supports filtering by eventType, status, IRN, and date range.',
      },
    }
  )

  /**
   * GET /webhook/events/:eventId
   * Get a single webhook event by its eventId, including full jobErrors history.
   */
  .get(
    '/:eventId',
    async ({ params, auth, webhookEventRepo }) => {
      try {
        const ev = await webhookEventRepo.findByEventId(params.eventId);

        if (!ev) {
          return { success: false, error: 'Webhook event not found', statusCode: 404 };
        }

        // Tenants can only access their own events
        if (!auth!.isAdmin && ev.tenantId !== auth!.tenantId) {
          return { success: false, error: 'Not authorized', statusCode: 403 };
        }

        return {
          success: true,
          data: {
            eventId: ev.eventId,
            tenantId: ev.tenantId,
            eventType: ev.eventType,
            status: ev.status,
            resourceId: ev.resourceId,
            resourceType: ev.resourceType,
            webhookUrl: ev.webhookUrl,
            payload: ev.payload,
            metadata: ev.metadata,
            irn: ev.metadata?.irn,
            erpInvoiceId: ev.metadata?.erpInvoiceId,
            jobErrors: ev.jobErrors ?? [],
            deliveryAttempts: ev.deliveryAttempts ?? [],
            maxRetries: ev.maxRetries,
            failureReason: ev.failureReason,
            deliveredAt: ev.deliveredAt,
            failedAt: ev.failedAt,
            nextRetryAt: ev.nextRetryAt,
            createdAt: ev.createdAt,
            updatedAt: ev.updatedAt,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message || 'Failed to fetch webhook event', statusCode: error.statusCode || 500 };
      }
    },
    {
      params: t.Object({ eventId: t.String() }),
      detail: {
        tags: ['Webhook Events'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Get Webhook Event',
        description: 'Get a single webhook event by its eventId. Includes full jobErrors history and delivery attempts.',
      },
    }
  );
