import { AppError } from '../../../@lib';
import { ModelWrapper } from '../../../@lib/adapters/mongo/model-wrapper';
import {
  WebhookEventDocument,
  WebhookEventModel,
  WebhookEventType,
  WebhookDeliveryStatus,
  IJobError,
} from '../models/webhook-event.model';

export class WebhookEventRepository {
  private webhookEventModel: ModelWrapper<WebhookEventDocument>;

  constructor() {
    this.webhookEventModel = new ModelWrapper<WebhookEventDocument>(WebhookEventModel);
  }

  /**
   * Build MongoDB query from where conditions
   */
  private buildWebhookEventQuery(where?: any): any {
    if (!where) return {};

    const query: any = {};

    // Simple equality checks
    if (where.id?._eq) query._id = where.id._eq;
    if (where.tenantId?._eq) query.tenantId = where.tenantId._eq;
    if (where.businessId?._eq) query.businessId = where.businessId._eq;
    if (where.eventId?._eq) query.eventId = where.eventId._eq;
    if (where.eventType?._eq) query.eventType = where.eventType._eq;
    if (where.resourceId?._eq) query.resourceId = where.resourceId._eq;
    if (where.status?._eq) query.status = where.status._eq;

    // IN conditions
    if (where.status?._in) query.status = { $in: where.status._in };
    if (where.eventType?._in) query.eventType = { $in: where.eventType._in };

    // Date range
    if (where.createdAt?._gte) query.createdAt = { ...query.createdAt, $gte: where.createdAt._gte };
    if (where.createdAt?._lte) query.createdAt = { ...query.createdAt, $lte: where.createdAt._lte };

    // Next retry check
    if (where.nextRetryAt?._lte) {
      query.nextRetryAt = { $lte: where.nextRetryAt._lte };
      query.status = WebhookDeliveryStatus.RETRY;
    }

    // AND conditions
    if (where._and && where._and.length > 0) {
      query.$and = where._and.map((andCondition: any) => {
        return this.buildWebhookEventQuery(andCondition);
      });
    }

    return query;
  }

  /**
   * Build select projection
   */
  private buildWebhookEventProjection(select?: any): any {
    return select && Object.keys(select).length > 0 ? select : null;
  }

  /**
   * Find many webhook events
   */
  async findMany(
    where?: any,
    select?: any,
    limit: number = 20,
    offset: number = 0
  ): Promise<WebhookEventDocument[]> {
    try {
      const query = this.buildWebhookEventQuery(where);
      const projection = this.buildWebhookEventProjection(select);

      const docs = await this.webhookEventModel
        .find(query, projection)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .exec();

      return docs;
    } catch (error) {
      console.error('Error finding webhook events:', error);
      throw new AppError(500, 'Failed to fetch webhook events');
    }
  }

  /**
   * Find one webhook event
   */
  async findOne(where: any, select?: any): Promise<WebhookEventDocument | null> {
    try {
      const query = this.buildWebhookEventQuery(where);
      const projection = this.buildWebhookEventProjection(select);

      const doc = await this.webhookEventModel.base.findOne(query, projection).exec();

      return doc;
    } catch (error) {
      console.error('Error finding webhook event:', error);
      throw new AppError(500, 'Failed to fetch webhook event');
    }
  }

  /**
   * Create a new webhook event
   */
  async create(data: Partial<WebhookEventDocument>): Promise<WebhookEventDocument> {
    try {
      const doc = await this.webhookEventModel.create({
        ...data,
        status: WebhookDeliveryStatus.PENDING,
        deliveryAttempts: [],
        maxRetries: data.maxRetries || 3,
      });

      return doc;
    } catch (error: any) {
      console.error('Error creating webhook event:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error.code === 11000) {
        throw new AppError(409, 'Webhook event with this eventId already exists');
      }
      throw new AppError(500, 'Failed to create webhook event');
    }
  }

  /**
   * Update a webhook event
   */
  async update(
    eventId: string,
    data: Partial<WebhookEventDocument>
  ): Promise<WebhookEventDocument> {
    try {
      // Remove undefined values
      const updateData = Object.keys(data).reduce((acc, key: string) => {
        const dataKey = key as keyof WebhookEventDocument;
        if (data[dataKey] !== undefined) {
          acc[key] = data[dataKey];
        }
        return acc;
      }, {} as any);

      const doc = await this.webhookEventModel.base
        .findOneAndUpdate({ eventId }, { $set: updateData }, { new: true, runValidators: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'Webhook event not found');
      }

      return doc;
    } catch (error: any) {
      console.error('Error updating webhook event:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to update webhook event');
    }
  }

  /**
   * Delete a webhook event
   */
  async delete(eventId: string): Promise<boolean> {
    try {
      const result = await this.webhookEventModel.base.findOneAndDelete({ eventId }).exec();

      return result !== null;
    } catch (error) {
      console.error('Error deleting webhook event:', error);
      throw new AppError(500, 'Failed to delete webhook event');
    }
  }

  /**
   * Count webhook events
   */
  async count(where?: any): Promise<number> {
    try {
      const query = this.buildWebhookEventQuery(where);
      const count = await this.webhookEventModel.countDocuments(query).exec();
      return count;
    } catch (error) {
      console.error('Error counting webhook events:', error);
      throw new AppError(500, 'Failed to count webhook events');
    }
  }

  /**
   * Find webhook events by tenant ID
   */
  async findByTenantId(
    tenantId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: WebhookEventDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { tenantId };

      const [docs, total] = await Promise.all([
        this.webhookEventModel.base
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.webhookEventModel.countDocuments(query).exec(),
      ]);

      const meta = {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };

      return {
        data: docs,
        meta,
      };
    } catch (error) {
      console.error('Error fetching webhook events:', error);
      throw new AppError(500, 'Failed to fetch webhook events');
    }
  }

  /**
   * Find webhook event by idempotency key for a tenant
   */
  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<WebhookEventDocument | null> {
    try {
      const doc = await this.webhookEventModel.base
        .findOne({ tenantId, 'metadata.idempotencyKey': idempotencyKey })
        .exec();
      return doc;
    } catch (error) {
      console.error('Error finding webhook event by idempotency key:', error);
      throw new AppError(500, 'Failed to fetch webhook event');
    }
  }

  /**
   * Find webhook event by event ID
   */
  async findByEventId(eventId: string): Promise<WebhookEventDocument | null> {
    try {
      const doc = await this.webhookEventModel.base.findOne({ eventId }).exec();
      return doc;
    } catch (error) {
      console.error('Error fetching webhook event:', error);
      throw new AppError(500, 'Failed to fetch webhook event');
    }
  }

  /**
   * Find webhook event by ID (alias for findByEventId or MongoDB _id)
   */
  async findById(id: string): Promise<WebhookEventDocument | null> {
    try {
      // Try finding by eventId first, then by _id
      let doc = await this.webhookEventModel.base.findOne({ eventId: id }).exec();
      if (!doc) {
        doc = await this.webhookEventModel.base.findById(id).exec();
      }
      return doc;
    } catch (error) {
      console.error('Error fetching webhook event by id:', error);
      throw new AppError(500, 'Failed to fetch webhook event');
    }
  }

  /**
   * Generic find with query object
   */
  async find(query: any, skip: number = 0, limit: number = 20): Promise<WebhookEventDocument[]> {
    try {
      const docs = await this.webhookEventModel.base
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec();
      return docs;
    } catch (error) {
      console.error('Error finding webhook events:', error);
      throw new AppError(500, 'Failed to fetch webhook events');
    }
  }

  /**
   * Update status of a webhook event
   */
  async updateStatus(eventId: string, status: WebhookDeliveryStatus): Promise<WebhookEventDocument | null> {
    try {
      const doc = await this.webhookEventModel.base
        .findOneAndUpdate(
          { eventId },
          { $set: { status } },
          { new: true }
        )
        .exec();
      return doc;
    } catch (error) {
      console.error('Error updating webhook status:', error);
      throw new AppError(500, 'Failed to update webhook status');
    }
  }

  /**
   * Find webhook events by resource ID
   */
  async findByResourceId(
    resourceId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: WebhookEventDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { resourceId };

      const [docs, total] = await Promise.all([
        this.webhookEventModel.base
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.webhookEventModel.countDocuments(query).exec(),
      ]);

      const meta = {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };

      return {
        data: docs,
        meta,
      };
    } catch (error) {
      console.error('Error fetching webhook events:', error);
      throw new AppError(500, 'Failed to fetch webhook events');
    }
  }

  /**
   * Add delivery attempt
   */
  async addDeliveryAttempt(
    eventId: string,
    attempt: {
      attemptNumber: number;
      timestamp: Date;
      httpStatus?: number;
      responseBody?: any;
      error?: string;
      duration: number;
    }
  ): Promise<WebhookEventDocument> {
    try {
      const doc = await this.webhookEventModel.base
        .findOneAndUpdate(
          { eventId },
          {
            $push: {
              deliveryAttempts: attempt,
            },
          },
          { new: true }
        )
        .exec();

      if (!doc) {
        throw new AppError(404, 'Webhook event not found');
      }

      return doc;
    } catch (error) {
      console.error('Error adding delivery attempt:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to add delivery attempt');
    }
  }

  /**
   * Mark as delivered
   */
  async markAsDelivered(
    eventId: string,
    httpStatus: number,
    responseBody: any
  ): Promise<WebhookEventDocument> {
    try {
      const doc = await this.webhookEventModel.base
        .findOneAndUpdate(
          { eventId },
          {
            $set: {
              status: WebhookDeliveryStatus.DELIVERED,
              deliveredAt: new Date(),
              finalHttpStatus: httpStatus,
              finalResponseBody: responseBody,
              nextRetryAt: null,
            },
          },
          { new: true }
        )
        .exec();

      if (!doc) {
        throw new AppError(404, 'Webhook event not found');
      }

      return doc;
    } catch (error) {
      console.error('Error marking webhook as delivered:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to mark webhook as delivered');
    }
  }

  /**
   * Mark as failed
   */
  async markAsFailed(
    eventId: string,
    failureReason: string,
    httpStatus?: number,
    responseBody?: any
  ): Promise<WebhookEventDocument> {
    try {
      const doc = await this.webhookEventModel.base
        .findOneAndUpdate(
          { eventId },
          {
            $set: {
              status: WebhookDeliveryStatus.FAILED,
              failedAt: new Date(),
              failureReason,
              finalHttpStatus: httpStatus,
              finalResponseBody: responseBody,
              nextRetryAt: null,
            },
          },
          { new: true }
        )
        .exec();

      if (!doc) {
        throw new AppError(404, 'Webhook event not found');
      }

      return doc;
    } catch (error) {
      console.error('Error marking webhook as failed:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to mark webhook as failed');
    }
  }

  /**
   * Append a job step failure to the event's jobErrors array
   */
  async appendJobError(eventId: string, jobError: IJobError): Promise<void> {
    try {
      await this.webhookEventModel.base
        .updateOne(
          { eventId },
          { $push: { jobErrors: jobError } }
        )
        .exec();
    } catch {
      // Non-critical — do not propagate
    }
  }

  /**
   * Schedule retry
   */
  async scheduleRetry(eventId: string, nextRetryAt: Date): Promise<WebhookEventDocument> {
    try {
      const doc = await this.webhookEventModel.base
        .findOneAndUpdate(
          { eventId },
          {
            $set: {
              status: WebhookDeliveryStatus.RETRY,
              nextRetryAt,
            },
          },
          { new: true }
        )
        .exec();

      if (!doc) {
        throw new AppError(404, 'Webhook event not found');
      }

      return doc;
    } catch (error) {
      console.error('Error scheduling webhook retry:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to schedule webhook retry');
    }
  }

  /**
   * Get pending webhooks ready for retry
   */
  async findPendingRetries(): Promise<WebhookEventDocument[]> {
    try {
      const docs = await this.webhookEventModel.base
        .find({
          status: WebhookDeliveryStatus.RETRY,
          nextRetryAt: { $lte: new Date() },
        })
        .sort({ nextRetryAt: 1 })
        .limit(100)
        .exec();

      return docs;
    } catch (error) {
      console.error('Error fetching pending retries:', error);
      throw new AppError(500, 'Failed to fetch pending retries');
    }
  }

  /**
   * Get failed webhooks
   */
  async findFailed(
    tenantId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: WebhookEventDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { tenantId, status: WebhookDeliveryStatus.FAILED };

      const [docs, total] = await Promise.all([
        this.webhookEventModel.base
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.webhookEventModel.countDocuments(query).exec(),
      ]);

      const meta = {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };

      return {
        data: docs,
        meta,
      };
    } catch (error) {
      console.error('Error fetching failed webhooks:', error);
      throw new AppError(500, 'Failed to fetch failed webhooks');
    }
  }

  /**
   * Bulk update webhook events
   */
  async bulkUpdate(
    updates: Array<{ eventId: string; data: Partial<WebhookEventDocument> }>
  ): Promise<boolean> {
    try {
      const bulkOps = updates.map((update) => ({
        updateOne: {
          filter: { eventId: update.eventId },
          update: { $set: update.data },
        },
      }));

      const result = await this.webhookEventModel.base.bulkWrite(bulkOps);
      return result.modifiedCount > 0;
    } catch (error) {
      console.error('Error bulk updating webhook events:', error);
      throw new AppError(500, 'Failed to bulk update webhook events');
    }
  }
}
