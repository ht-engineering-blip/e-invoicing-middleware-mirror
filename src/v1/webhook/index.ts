// Webhook module routes
import { Elysia, sse, t } from 'elysia';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { TenantRepository } from '../tenants/repos/tenant.repo';
import { WebhookEventRepository } from './repos/webhook-event.repo';
import { WebhookDeliveryStatus, WebhookEventType } from './models';
import { hashString, logger, UnauthorizedError } from '../../@lib';
import {
  cors
} from '@elysiajs/cors'
import { sleep } from 'bun';

const tenantRepo = new TenantRepository();
const webhookEventRepo = new WebhookEventRepository();

/**
 * In-memory event bus for real-time SSE streaming per webhook path.
 */
const webhookBus = new EventEmitter();
webhookBus.setMaxListeners(0);

export const webhookRoutes = new Elysia({ 
  prefix: '/webhook', 
})
  .use(cors())

  /**
   * GET /webhook/listen/:webhookPath
   * SSE endpoint - subscribe to real-time inbound webhook events.
   * Clients connect here to listen for data as it arrives on the webhook.
   */
  .get(
    '/listen/:webhookPath',
    async function* ({ params, set }) {
      const { webhookPath } = params;

      // Validate tenant
      const tenant = await tenantRepo.findByWebhookPath(webhookPath);
      if (!tenant) {
        set.status = 404;
        return;
      }

      const channel = `wh:${webhookPath}`;
      const queue: any[] = [];
      let resolve: (() => void) | null = null;

      const handler = (data: any) => {
        console.log({ data })
        queue.push(data);
        if (resolve) {
          resolve();
          resolve = null;
        }
      };

      webhookBus.on(channel, handler);

      // Send initial connection event
      yield sse({
        event: 'connected',
        data: {
          tenantId: tenant.tenantId,
          webhookPath,
          connectedAt: new Date().toISOString(),
          message: 'Listening for inbound webhook events',
        },
      });

      try {
        while (true) {
          if (queue.length === 0) {
            await new Promise<void>((r) => {
              resolve = r; 
            });
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
      } catch(e){
        console.log({e})
      } finally {
        webhookBus.off(channel, handler);
        logger.info('SSE client disconnected', {
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
        tags: ['Webhook - Inbound'],
        summary: 'Listen for inbound webhook events',
        description:
          'Connect to receive real-time (SSE) inbound webhook data as it arrives for this tenant.',
      },
    }
  )

  /**
   * POST /webhook/inbound/:webhookPath
   * Receive inbound data from tenants via their unique webhook URL
   * No auth middleware - verified via webhookPath + signature
   */
  .post(
    '/inbound/:webhookPath',
    async ({ params, body, headers, set }) => {
      const { webhookPath } = params;

      // 1. Look up tenant by webhook path
      const tenant = await tenantRepo.findByWebhookPath(webhookPath);
      if (!tenant) {
        set.status = 404;
        return {
          success: false,
          error: 'Invalid webhook path',
        };
      }

      // 2. Verify webhook is enabled
      if (!tenant.config?.webhookEnabled) {
        set.status = 403;
        return {
          success: false,
          error: 'Webhook is not enabled for this tenant',
        };
      }

      // 3. Verify signature if provided
      const webhookKey = hashString(headers['x-webhook-key']!);
      const webhookKeyHash = tenant.metadata?.webhookSecretHash;
      /*    const signature = headers['x-webhook-key'];
         const webhookSecretHash = tenant.metadata?.webhookSecretHash; */
      const passwordHash = hashString(webhookKey!);
      const storedPasswordHash = (tenant as any)?.password;

      if (webhookKeyHash && !webhookKey) {
        set.status = 401;
        return {
          success: false,
          error: 'Missing X-Webhook-Key header',
        };
      }

      if (!webhookKeyHash || webhookKey !== webhookKeyHash) {
        throw new UnauthorizedError('Invalid webhook key');
      }




      // 4. Determine event type from payload or headers
      const eventType =
        headers['x-event-type'] ||
        (body as any)?.event ||
        (body as any)?.eventType ||
        WebhookEventType.INVOICE_RECEIVED;

      // 5. Resolve idempotency key
      //    Prefer X-Idempotency-Key header; fall back to a content hash so
      //    identical payloads sent without a key are also de-duplicated.
      const idempotencyKey =
        headers['x-idempotency-key'] ||
        crypto
          .createHash('sha256')
          .update(`${tenant.tenantId}:${eventType}:${JSON.stringify(body)}`)
          .digest('hex');

      // 6. Check for an existing event with this idempotency key
      const existing = await webhookEventRepo.findByIdempotencyKey(
        tenant.tenantId,
        idempotencyKey
      );

      if (existing) {
        if (existing.status !== WebhookDeliveryStatus.FAILED) {
          // Already processed successfully (DELIVERED / PENDING / RETRY) — return cached response
          set.status = 200;
          return {
            success: true,
            message: 'Webhook already received (idempotent)',
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
        logger.info('Reprocessing failed webhook event', {
          tenantId: tenant.tenantId,
          existingEventId: existing.eventId,
          idempotencyKey,
        });
      }

      // 7. Store the webhook event
      const eventId = `wh_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

      try {
        await webhookEventRepo.create({
          tenantId: tenant.tenantId,
          eventId,
          eventType,
          payload: body,
          resourceId: (body as any)?.irn || (body as any)?.invoiceId || (body as any)?.resourceId || eventId,
          resourceType: (body as any)?.resourceType || 'invoice',
          webhookUrl: tenant.metadata?.webhookUrl || '',
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
          metadata: {
            source: 'inbound',
            webhookPath,
            idempotencyKey,
            receivedAt: new Date().toISOString(),
            headers: {
              'content-type': headers['content-type'],
              'x-event-type': headers['x-event-type'],
              'user-agent': headers['user-agent'],
            },
          },
        } as any);

        logger.info('Inbound webhook received', {
          tenantId: tenant.tenantId,
          eventId,
          eventType,
        });

        // 6. Push to SSE listeners on this webhookPath
        webhookBus.emit(`wh:${webhookPath}`, {
          eventId,
          tenantId: tenant.tenantId,
          eventType,
          payload: body,
          receivedAt: new Date().toISOString(),
        });

        return {
          success: true,
          message: 'Webhook received successfully',
          data: {
            eventId,
            tenantId: tenant.tenantId,
            eventType,
            receivedAt: new Date().toISOString(),
          },
        };
      } catch (error: any) {
        logger.error('Failed to process inbound webhook', {
          webhookPath,
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: 'Failed to process webhook',
        };
      }
    },
    {
      params: t.Object({
        webhookPath: t.String(),
      }),
      detail: {
        tags: ['Webhook - Inbound'],
        summary: 'Receive inbound webhook',
        description:
          'Endpoint for tenants to send data to the platform.',
      },
    }
  );
