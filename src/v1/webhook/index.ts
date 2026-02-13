// Webhook module routes
import { Elysia, t } from 'elysia';
import crypto from 'crypto';
import { TenantRepository } from '../tenants/repos/tenant.repo';
import { WebhookEventRepository } from './repos/webhook-event.repo';
import { WebhookDeliveryStatus, WebhookEventType } from './models';
import { logger } from '../../@lib';

const tenantRepo = new TenantRepository();
const webhookEventRepo = new WebhookEventRepository();

export const webhookRoutes = new Elysia({ prefix: '/webhook' })

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
      const signature = headers['x-webhook-signature'];
      const webhookSecretHash = tenant.metadata?.webhookSecretHash;

      if (webhookSecretHash && signature) {
        const payloadString = JSON.stringify(body);
        const expectedSignature = crypto
          .createHmac('sha256', webhookSecretHash)
          .update(payloadString)
          .digest('hex');

        const isValid = crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature)
        );

        if (!isValid) {
          set.status = 401;
          return {
            success: false,
            error: 'Invalid webhook signature',
          };
        }
      } else if (webhookSecretHash && !signature) {
        set.status = 401;
        return {
          success: false,
          error: 'Missing X-Webhook-Signature header',
        };
      }

      // 4. Determine event type from payload or headers
      const eventType =
        headers['x-event-type'] ||
        (body as any)?.event ||
        (body as any)?.eventType ||
        WebhookEventType.INVOICE_RECEIVED;

      // 5. Store the webhook event
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
          'Endpoint for tenants to send data to the platform. Verified via unique webhook path and HMAC-SHA256 signature.',
      },
    }
  );
