/**
 * Webhook Service
 * Business logic for webhook event delivery and retry logic
 */

import { WebhookEventRepository } from '../repos/webhook-event.repo';
import { TenantRepository } from '../../tenants/repos/tenant.repo';
import { AuditLogRepository } from '../../audit/repos/audit-log.repo';
import { NotFoundError, ValidationError } from '../../../@lib/errors';
import { WebhookEventType, WebhookDeliveryStatus, type WebhookEventDocument } from '../models';
import { AuditEventType, AuditEventSeverity } from '../../audit/models';
import type { ITenantConfig } from '../../tenants/models/tenant.model';
import axios from 'axios';
import crypto from 'crypto';
import { isSafeUrl } from '../../../@lib/utils/ssrf';

// Concurrency tracking for outbound webhook deliveries
const concurrentGlobal = { count: 0 };
const concurrentTenant = new Map<string, number>();

const MAX_CONCURRENT_GLOBAL = 100;
const MAX_CONCURRENT_PER_TENANT = 10;

export interface DeliverWebhookInput {
  eventId: string;
}

export interface RetryWebhookInput {
  eventId: string;
}

export interface ConfigureWebhookInput {
  tenantId: string;
  webhookUrl: string;
  webhookSecret?: string;
  enabled: boolean;
}

export interface TestWebhookInput {
  tenantId: string;
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
    const tenant = await this.tenantRepo.findByTenantId(event.tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const webhookUrl = tenant.config?.webhookUrl;
    const webhookEnabled = tenant.config?.webhookEnabled;
    const webhookSecret = tenant.config?.webhookAuth || '';

    if (!webhookUrl || !webhookEnabled) {
      throw new ValidationError('Webhook not configured or disabled for tenant');
    }

    // SSRF URL Validation
    if (!(await isSafeUrl(webhookUrl))) {
      const errorMsg = `Outbound webhook URL is blocked by SSRF guard: ${webhookUrl}`;
      await this.webhookRepo.markAsFailed(event.eventId, errorMsg, 400);
      
      // Audit log
      await this.createAuditLog(event.tenantId, 'webhook.failed', 'webhook_event', event.eventId, {
        error: { message: errorMsg },
      });

      throw new ValidationError(errorMsg);
    }

    // Check if max retries exceeded
    const attempts = event.deliveryAttempts?.length || 0;
    if (attempts >= this.MAX_RETRIES) {
      await this.webhookRepo.updateStatus(eventId, WebhookDeliveryStatus.FAILED);
      throw new ValidationError('Max retry attempts exceeded');
    }

    try {
      // Prepare webhook payload
      const webhookPayload = {
        eventId: event.eventId,
        eventType: event.eventType,
        tenantId: event.tenantId, 
        timestamp: new Date().toISOString(),
        data: event.payload,
      };

      // Generate signature using both formats for complete backward compatibility
      const legacySignature = this.generateSignature(webhookPayload, webhookSecret);
      
      const now = Math.floor(Date.now() / 1000);
      const payloadString = JSON.stringify(webhookPayload);
      const hmacVal = crypto.createHmac('sha256', webhookSecret).update(`${now}.${payloadString}`).digest('hex');
      const secureSignature = `t=${now},v1=${hmacVal}`;

      // Concurrency limits check
      if (concurrentGlobal.count >= MAX_CONCURRENT_GLOBAL) {
        throw new Error('Global concurrent webhook delivery limit exceeded');
      }
      const tenantConcurrent = concurrentTenant.get(event.tenantId) || 0;
      if (tenantConcurrent >= MAX_CONCURRENT_PER_TENANT) {
        throw new Error(`Concurrent webhook delivery limit exceeded for tenant ${event.tenantId}`);
      }

      // Increment concurrency counters
      concurrentGlobal.count++;
      concurrentTenant.set(event.tenantId, tenantConcurrent + 1);

      let response;
      try {
        // Send webhook request
        const startTime = Date.now();
        response = await axios.post(webhookUrl, webhookPayload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Key': legacySignature,
            'X-Webhook-Signature': secureSignature,
            'X-Event-Type': event.eventType,
          },
          timeout: 30000, // 30 second timeout
          maxRedirects: 0, // SSRF Guard: do not follow redirects
        });
        const duration = Date.now() - startTime;

        // Add delivery attempt
        await this.webhookRepo.addDeliveryAttempt(event.eventId, {
          attemptNumber: attempts + 1,
          timestamp: new Date(),
          httpStatus: response.status,
          responseBody: response.data,
          duration,
        });

        // Mark as delivered
        const updated = await this.webhookRepo.markAsDelivered(
          event.eventId,
          response.status,
          response.data
        );

        // Audit log
        await this.createAuditLog(event.tenantId, 'webhook.delivered', 'webhook_event', event.eventId, {
          eventType: event.eventType,
          statusCode: response.status,
        });

        return updated!;
      } finally {
        // Decrement concurrency counters
        concurrentGlobal.count = Math.max(0, concurrentGlobal.count - 1);
        const currentCount = concurrentTenant.get(event.tenantId) || 0;
        if (currentCount <= 1) {
          concurrentTenant.delete(event.tenantId);
        } else {
          concurrentTenant.set(event.tenantId, currentCount - 1);
        }
      }
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

      // Add failed delivery attempt
      await this.webhookRepo.addDeliveryAttempt(event.eventId, {
        attemptNumber: attempts + 1,
        timestamp: new Date(),
        httpStatus: error.response?.status,
        error: error.message,
        duration: 0,
      });

      // Schedule retry or mark as failed
      const shouldRetry = attempts + 1 < this.MAX_RETRIES;
      if (shouldRetry) {
        const nextRetryDelay = this.RETRY_DELAYS[attempts] || 7200;
        const nextRetryAt = new Date(Date.now() + nextRetryDelay * 1000);

        await this.webhookRepo.scheduleRetry(event.eventId, nextRetryAt);

        // Audit log
        await this.createAuditLog(event.tenantId, 'webhook.retry_scheduled', 'webhook_event', event.eventId, {
          attempt: attempts + 1,
          nextRetryAt,
          error: errorDetails,
        });
      } else {
        // Max retries exceeded, mark as failed
        await this.webhookRepo.markAsFailed(event.eventId, error.message, error.response?.status);

        await this.createAuditLog(event.tenantId, 'webhook.failed', 'webhook_event', event.eventId, {
          attempts: attempts + 1,
          error: errorDetails,
        });
      }

      // Return current state
      const currentEvent = await this.webhookRepo.findById(eventId);
      return currentEvent!;
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

    if (event.status === WebhookDeliveryStatus.DELIVERED) {
      throw new ValidationError('Webhook already delivered');
    }

    // Reset if manually retrying a failed event
    if (event.status === WebhookDeliveryStatus.FAILED) {
      await this.webhookRepo.update(event.eventId, {
        status: WebhookDeliveryStatus.PENDING,
        deliveryAttempts: [],
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
        await this.deliverWebhook(event.eventId);
      } catch (error) {
        // Log error but continue processing other events
        console.error(`Failed to deliver webhook ${event.eventId}:`, error);
      }
    }
  }

  /**
   * List webhook events for tenant
   */
  async listWebhookEvents(
    tenantId: string,
    filters?: {
      eventType?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      skip?: number;
      limit?: number;
    }
  ): Promise<{ events: WebhookEventDocument[]; total: number }> {
    const query: any = { tenantId };

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
  async getWebhookEvent(eventId: string, tenantId: string): Promise<WebhookEventDocument> {
    const event = await this.webhookRepo.findById(eventId);
    if (!event || event.tenantId !== tenantId) {
      throw new NotFoundError('Webhook event not found');
    }

    return event;
  }

  /**
   * Configure webhook for tenant
   */
  async configureWebhook(input: ConfigureWebhookInput): Promise<void> {
    const tenant = await this.tenantRepo.findByTenantId(input.tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const config: Partial<ITenantConfig> = tenant.config || {};
    config.webhookUrl = input.webhookUrl;
    config.webhookEnabled = input.enabled;

    if (input.webhookSecret) {
      config.webhookAuth = input.webhookSecret;
    }

    await this.tenantRepo.update(tenant.tenantId, { config } as any);

    // Audit log
    await this.createAuditLog(input.tenantId, 'webhook.configured', 'tenant', tenant.tenantId, {
      webhookUrl: input.webhookUrl,
      enabled: input.enabled,
    });
  }

  /**
   * Test webhook delivery
   */
  async testWebhook(input: TestWebhookInput): Promise<any> {
    const tenant = await this.tenantRepo.findByTenantId(input.tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const webhookUrl = tenant.config?.webhookUrl;
    const webhookEnabled = tenant.config?.webhookEnabled;

    if (!webhookUrl || !webhookEnabled) {
      throw new ValidationError('Webhook not configured or disabled');
    }

    // Generate event ID
    const eventId = `evt_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create test event
    const testEvent = await this.webhookRepo.create({
      eventId,
      tenantId: input.tenantId, 
      eventType: (input.eventType || WebhookEventType.TEST_EVENT) as WebhookEventType,
      payload: input.payload || { test: true, timestamp: new Date().toISOString() },
      resourceId: 'test',
      resourceType: 'test',
      webhookUrl,
      status: WebhookDeliveryStatus.PENDING,
      maxRetries: 0,
    });

    // Deliver test event
    try {
      const result = await this.deliverWebhook(testEvent.eventId);
      return {
        success: true,
        eventId: testEvent.eventId,
        status: result.status,
        httpStatus: result.finalHttpStatus,
        response: result.finalResponseBody,
      };
    } catch (error: any) {
      return {
        success: false,
        eventId: testEvent.eventId,
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

    // Audit log
    await this.createAuditLog('system', 'firs_webhook.received', 'webhook', irn || 'unknown', {
      eventType,
      irn,
    });

    // Process based on event type
    // This would trigger invoice service methods
    // Implementation depends on specific FIRS webhook events
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
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  }

  /**
   * Helper to create audit log entries
   */
  private async createAuditLog(
    tenantId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: any
  ): Promise<void> {
    try {
      const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await this.auditRepo.create({
        eventId,
        tenantId,
        eventType: AuditEventType.SYSTEM_WARNING, // Generic event type for webhook actions
        severity: AuditEventSeverity.INFO,
        actor: {
          actorType: 'system',
          actorId: 'webhook_service',
        },
        resource: {
          resourceType,
          resourceId,
        },
        description: action,
        metadata,
        timestamp: new Date(),
      });
    } catch (error) {
      // Don't fail the main operation if audit logging fails
      console.error('Failed to create audit log:', error);
    }
  }
}
