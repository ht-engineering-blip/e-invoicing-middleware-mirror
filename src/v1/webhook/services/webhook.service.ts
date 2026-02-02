/**
 * Webhook Service
 * Business logic for webhook event delivery and retry logic
 */

import { WebhookEventRepository } from '../repos/webhook-event.repo';
import { TenantRepository } from '../../tenants/repos/tenant.repo';
import { AuditLogRepository } from '../../audit/repos/audit-log.repo';
import { AppError, NotFoundError, ValidationError } from '../../../@lib/errors';
import { WebhookEventType, type WebhookEventDocument } from '../models';
import axios, { AxiosError } from 'axios';
import crypto from 'crypto';

export interface DeliverWebhookInput {
  eventId: string;
}

export interface RetryWebhookInput {
  eventId: string;
}

export interface ConfigureWebhookInput {
  businessId: string;
  webhookUrl: string;
  webhookSecret?: string;
  enabled: boolean;
}

export interface TestWebhookInput {
  businessId: string;
  eventType: string;
  payload?: any;
}

export class WebhookService {
  private webhookRepo: WebhookEventRepository;
  private tenantRepo: TenantRepository;
  private auditRepo: AuditLogRepository;

  // Retry configuration
  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAYS = [60, 300, 900, 3600, 7200]; // seconds: 1min, 5min, 15min, 1hr, 2hr

  constructor() {
    this.webhookRepo = new WebhookEventRepository();
    this.tenantRepo = new TenantRepository();
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Deliver webhook event
   */
  async deliverWebhook(eventId: string): Promise<WebhookEventDocument> {
    const event = await this.webhookRepo.findById(eventId);
    if (!event) {
      throw new NotFoundError('Webhook event not found');
    }

    // Get tenant webhook configuration
    const tenant = await this.tenantRepo.findById(event.tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    if (!tenant.webhookUrl || !tenant.webhookEnabled) {
      throw new ValidationError('Webhook not configured or disabled for tenant');
    }

    // Check if max retries exceeded
    if (event.attempts >= this.MAX_RETRIES) {
      await this.webhookRepo.updateStatus(eventId, 'failed');
      throw new ValidationError('Max retry attempts exceeded');
    }

    try {
      // Prepare webhook payload
      const webhookPayload = {
        eventId: event._id.toString(),
        eventType: event.eventType,
        businessId: event.businessId,
        timestamp: new Date().toISOString(),
        data: event.payload,
      };

      // Generate signature
      const signature = this.generateSignature(webhookPayload, tenant.webhookSecret || '');

      // Send webhook request
      const response = await axios.post(tenant.webhookUrl, webhookPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Event-Type': event.eventType,
        },
        timeout: 30000, // 30 second timeout
      });

      // Update event as delivered
      const updated = await this.webhookRepo.update(event._id.toString(), {
        status: 'delivered',
        attempts: event.attempts + 1,
        deliveredAt: new Date(),
        response: {
          statusCode: response.status,
          body: response.data,
        },
      });

      // Audit log
      await this.auditRepo.create({
        businessId: event.businessId,
        tenantId: event.tenantId,
        action: 'webhook.delivered',
        resource: 'webhook_event',
        resourceId: event._id.toString(),
        userId: 'system',
        metadata: {
          eventType: event.eventType,
          statusCode: response.status,
        },
      });

      return updated!;
    } catch (error: any) {
      // Handle delivery failure
      const isAxiosError = error.isAxiosError;
      const errorDetails = isAxiosError
        ? {
            statusCode: error.response?.status,
            message: error.message,
            body: error.response?.data,
          }
        : {
            message: error.message,
          };

      // Update event with error
      const updated = await this.webhookRepo.update(event._id.toString(), {
        status: 'pending',
        attempts: event.attempts + 1,
        lastError: errorDetails,
      });

      // Schedule retry
      const shouldRetry = event.attempts + 1 < this.MAX_RETRIES;
      if (shouldRetry) {
        const nextRetryDelay = this.RETRY_DELAYS[event.attempts] || 7200;
        const nextRetryAt = new Date(Date.now() + nextRetryDelay * 1000);

        await this.webhookRepo.update(event._id.toString(), {
          nextRetryAt,
        });

        // Audit log
        await this.auditRepo.create({
          businessId: event.businessId,
          tenantId: event.tenantId,
          action: 'webhook.retry_scheduled',
          resource: 'webhook_event',
          resourceId: event._id.toString(),
          userId: 'system',
          metadata: {
            attempt: event.attempts + 1,
            nextRetryAt,
            error: errorDetails,
          },
        });
      } else {
        // Max retries exceeded, mark as failed
        await this.webhookRepo.updateStatus(event._id.toString(), 'failed');

        await this.auditRepo.create({
          businessId: event.businessId,
          tenantId: event.tenantId,
          action: 'webhook.failed',
          resource: 'webhook_event',
          resourceId: event._id.toString(),
          userId: 'system',
          metadata: {
            attempts: event.attempts + 1,
            error: errorDetails,
          },
        });
      }

      return updated!;
    }
  }

  /**
   * Retry webhook event manually
   */
  async retryWebhook(eventId: string): Promise<WebhookEventDocument> {
    const event = await this.webhookRepo.findById(eventId);
    if (!event) {
      throw new NotFoundError('Webhook event not found');
    }

    if (event.status === 'delivered') {
      throw new ValidationError('Webhook already delivered');
    }

    // Reset attempts if manually retrying a failed event
    if (event.status === 'failed') {
      await this.webhookRepo.update(eventId, {
        status: 'pending',
        attempts: 0,
      });
    }

    return this.deliverWebhook(eventId);
  }

  /**
   * Get pending retries
   * Returns events that need to be retried
   */
  async getPendingRetries(): Promise<WebhookEventDocument[]> {
    return this.webhookRepo.findPendingRetries();
  }

  /**
   * Process pending retries
   * Background job to process retry queue
   */
  async processPendingRetries(): Promise<void> {
    const pendingEvents = await this.getPendingRetries();

    for (const event of pendingEvents) {
      try {
        await this.deliverWebhook(event._id.toString());
      } catch (error) {
        // Log error but continue processing other events
        console.error(`Failed to deliver webhook ${event._id}:`, error);
      }
    }
  }

  /**
   * List webhook events for tenant
   */
  async listWebhookEvents(
    businessId: string,
    filters?: {
      eventType?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      skip?: number;
      limit?: number;
    }
  ): Promise<{ events: WebhookEventDocument[]; total: number }> {
    const query: any = { businessId };

    if (filters?.eventType) query.eventType = filters.eventType;
    if (filters?.status) query.status = filters.status;
    if (filters?.startDate || filters?.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = filters.startDate;
      if (filters.endDate) query.createdAt.$lte = filters.endDate;
    }

    const skip = filters?.skip || 0;
    const limit = filters?.limit || 20;

    const events = await this.webhookRepo.find(query, skip, limit);
    const total = await this.webhookRepo.count(query);

    return { events, total };
  }

  /**
   * Get webhook event by ID
   */
  async getWebhookEvent(eventId: string, businessId: string): Promise<WebhookEventDocument> {
    const event = await this.webhookRepo.findById(eventId);
    if (!event || event.businessId !== businessId) {
      throw new NotFoundError('Webhook event not found');
    }

    return event;
  }

  /**
   * Configure webhook for tenant
   */
  async configureWebhook(input: ConfigureWebhookInput): Promise<void> {
    const tenant = await this.tenantRepo.findByBusinessId(input.businessId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const updateData: any = {
      webhookUrl: input.webhookUrl,
      webhookEnabled: input.enabled,
    };

    if (input.webhookSecret) {
      updateData.webhookSecret = input.webhookSecret;
    }

    await this.tenantRepo.update(tenant.tenantId, updateData);

    // Audit log
    await this.auditRepo.create({
      businessId: input.businessId,
      tenantId: tenant.tenantId,
      action: 'webhook.configured',
      resource: 'tenant',
      resourceId: tenant.tenantId,
      userId: 'system',
      metadata: {
        webhookUrl: input.webhookUrl,
        enabled: input.enabled,
      },
    });
  }

  /**
   * Test webhook delivery
   */
  async testWebhook(input: TestWebhookInput): Promise<any> {
    const tenant = await this.tenantRepo.findByBusinessId(input.businessId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    if (!tenant.webhookUrl || !tenant.webhookEnabled) {
      throw new ValidationError('Webhook not configured or disabled');
    }

    // Create test event
    const testEvent = await this.webhookRepo.create({
      businessId: input.businessId,
      tenantId: tenant.tenantId,
      eventType: (input.eventType || WebhookEventType.TEST_EVENT) as WebhookEventType,
      payload: input.payload || { test: true, timestamp: new Date().toISOString() },
      status: 'pending',
      attempts: 0,
    });

    // Deliver test event
    try {
      const result = await this.deliverWebhook(testEvent._id.toString());
      return {
        success: true,
        eventId: testEvent._id.toString(),
        status: result.status,
        response: result.response,
      };
    } catch (error: any) {
      return {
        success: false,
        eventId: testEvent._id.toString(),
        error: error.message,
      };
    }
  }

  /**
   * Handle FIRS webhook (inbound)
   * Process webhooks received from FIRS
   */
  async handleFIRSWebhook(webhookData: any): Promise<void> {
    const eventType = webhookData.type || webhookData.eventType;
    const irn = webhookData.irn;

    // Validate webhook signature if provided
    // const isValid = this.validateFIRSSignature(webhookData);
    // if (!isValid) {
    //   throw new ValidationError('Invalid webhook signature');
    // }

    // Audit log
    await this.auditRepo.create({
      businessId: 'system',
      tenantId: 'system',
      action: 'firs_webhook.received',
      resource: 'webhook',
      resourceId: irn || 'unknown',
      userId: 'firs',
      metadata: {
        eventType,
        irn,
      },
    });

    // Process based on event type
    // This would trigger invoice service methods
    // Implementation depends on specific FIRS webhook events
  }

  /**
   * Validate FIRS webhook signature
   */
  private validateFIRSSignature(webhookData: any, secret?: string): boolean {
    // Implement FIRS signature validation
    // This depends on FIRS webhook signature scheme
    return true;
  }

  /**
   * Generate webhook signature
   */
  private generateSignature(payload: any, secret: string): string {
    const payloadString = JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload: any, signature: string, secret: string): boolean {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }
}
