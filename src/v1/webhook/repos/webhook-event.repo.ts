import { AppError } from "../../../@lib";
import { ModelWrapper } from "../../../@lib/adapters/mongo/model-wrapper";
import {
  WebhookEventDocument,
  WebhookEventModel,
  WebhookEventType,
  WebhookDeliveryStatus,
  IJobError,
} from "../models/webhook-event.model";

export class WebhookEventRepository {
  private webhookEventModel: ModelWrapper<WebhookEventDocument>;

  constructor() {
    this.webhookEventModel = new ModelWrapper<WebhookEventDocument>(
      WebhookEventModel,
    );
  }

  /**
   * Build MongoDB query from where conditions or raw query object
   */
  private buildWebhookEventQuery(where?: any): any {
    if (!where || typeof where !== "object") return {};

    const query: any = {};

    for (const [key, value] of Object.entries(where)) {
      if (key === "_and" && Array.isArray(value)) {
        query.$and = value.map((cond) => this.buildWebhookEventQuery(cond));
      } else if (key === "_or" && Array.isArray(value)) {
        query.$or = value.map((cond) => this.buildWebhookEventQuery(cond));
      } else if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !(value instanceof Date) &&
        !(value instanceof RegExp)
      ) {
        const valObj = value as Record<string, any>;
        const hasCustomOps = Object.keys(valObj).some((k) => k.startsWith("_"));

        if (hasCustomOps) {
          if (valObj._eq !== undefined) {
            query[key === "id" ? "_id" : key] = valObj._eq;
            continue;
          }

          const fieldQuery: any = {};
          if (valObj._in !== undefined) fieldQuery.$in = valObj._in;
          if (valObj._nin !== undefined) fieldQuery.$nin = valObj._nin;
          if (valObj._gte !== undefined) fieldQuery.$gte = valObj._gte;
          if (valObj._lte !== undefined) fieldQuery.$lte = valObj._lte;
          if (valObj._gt !== undefined) fieldQuery.$gt = valObj._gt;
          if (valObj._lt !== undefined) fieldQuery.$lt = valObj._lt;
          if (valObj._ne !== undefined) fieldQuery.$ne = valObj._ne;
          if (valObj._like !== undefined) fieldQuery.$regex = valObj._like;
          if (valObj._ilike !== undefined) {
            fieldQuery.$regex = valObj._ilike;
            fieldQuery.$options = "i";
          }

          if (key === "nextRetryAt" && valObj._lte !== undefined) {
            query.status = WebhookDeliveryStatus.RETRY;
          }

          query[key === "id" ? "_id" : key] = fieldQuery;
        } else {
          // Standard Mongo operators/subdocuments ($regex, $gte, etc.)
          query[key === "id" ? "_id" : key] = value;
        }
      } else {
        // Direct value (primitive, string, array, Date, RegExp, etc.)
        query[key === "id" ? "_id" : key] = value;
      }
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
    offset: number = 0,
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
      console.error("Error finding webhook events:", error);
      throw new AppError(500, "Failed to fetch webhook events");
    }
  }

  /**
   * Find one webhook event
   */
  async findOne(
    where: any,
    select?: any,
  ): Promise<WebhookEventDocument | null> {
    try {
      const query = this.buildWebhookEventQuery(where);
      const projection = this.buildWebhookEventProjection(select);

      const doc = await this.webhookEventModel
        .findOne(query, projection)
        .exec();

      return doc;
    } catch (error) {
      console.error("Error finding webhook event:", error);
      throw new AppError(500, "Failed to fetch webhook event");
    }
  }

  /**
   * Create a new webhook event
   */
  async create(
    data: Partial<WebhookEventDocument>,
  ): Promise<WebhookEventDocument> {
    try {
      const doc = await this.webhookEventModel.create({
        ...data,
        status: WebhookDeliveryStatus.PENDING,
        deliveryAttempts: [],
        maxRetries: data.maxRetries || 3,
      });

      return doc;
    } catch (error: any) {
      console.error("Error creating webhook event:", error);
      if (error.name === "ValidationError") {
        throw new AppError(400, error);
      }
      if (error.code === 11000) {
        throw new AppError(
          409,
          "Webhook event with this eventId already exists",
        );
      }
      throw new AppError(500, "Failed to create webhook event");
    }
  }

  /**
   * Update a webhook event
   */
  async update(
    eventId: string,
    data: Partial<WebhookEventDocument>,
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

      const doc = await this.webhookEventModel
        .findOneAndUpdate(
          { eventId },
          { $set: updateData },
          { returnDocument: "after", runValidators: true },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Webhook event not found");
      }

      return doc;
    } catch (error: any) {
      console.error("Error updating webhook event:", error);
      if (error.name === "ValidationError") {
        throw new AppError(400, error);
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to update webhook event");
    }
  }

  /**
   * Delete a webhook event
   */
  async delete(eventId: string): Promise<boolean> {
    try {
      const result = await this.webhookEventModel
        .findOneAndDelete({ eventId })
        .exec();

      return result !== null;
    } catch (error) {
      console.error("Error deleting webhook event:", error);
      throw new AppError(500, "Failed to delete webhook event");
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
      console.error("Error counting webhook events:", error);
      throw new AppError(500, "Failed to count webhook events");
    }
  }

  /**
   * Find webhook events by tenant ID
   */
  async findByTenantId(
    tenantId: string,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: WebhookEventDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { tenantId };

      const [docs, total] = await Promise.all([
        this.webhookEventModel
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
      console.error("Error fetching webhook events:", error);
      throw new AppError(500, "Failed to fetch webhook events");
    }
  }

  /**
   * Find webhook event by idempotency key for a tenant
   */
  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<WebhookEventDocument | null> {
    try {
      const doc = await this.webhookEventModel
        .findOne({ tenantId, "metadata.idempotencyKey": idempotencyKey })
        .exec();
      return doc;
    } catch (error) {
      console.error("Error finding webhook event by idempotency key:", error);
      throw new AppError(500, "Failed to fetch webhook event");
    }
  }

  /**
   * Find webhook event by event ID
   */
  async findByEventId(
    eventId: string,
    tenantId?: string,
  ): Promise<WebhookEventDocument | null> {
    try {
      const query: any = { eventId };
      if (tenantId) query.tenantId = tenantId;
      const doc = await this.webhookEventModel.findOne(query).exec();
      return doc;
    } catch (error) {
      console.error("Error fetching webhook event:", error);
      throw new AppError(500, "Failed to fetch webhook event");
    }
  }

  /**
   * Find webhook event by ID (alias for findByEventId or MongoDB _id)
   */
  async findById(
    id: string,
    tenantId?: string,
  ): Promise<WebhookEventDocument | null> {
    try {
      // Try finding by eventId first, then by _id
      const query1: any = { eventId: id };
      if (tenantId) query1.tenantId = tenantId;
      let doc = await this.webhookEventModel.findOne(query1).exec();
      if (!doc) {
        const query2: any = { _id: id };
        if (tenantId) query2.tenantId = tenantId;
        doc = await this.webhookEventModel.findOne(query2).exec();
      }
      return doc;
    } catch (error) {
      console.error("Error fetching webhook event by id:", error);
      throw new AppError(500, "Failed to fetch webhook event");
    }
  }

  /**
   * Generic find with query object
   */
  async find(
    query: any,
    skip: number = 0,
    limit: number = 20,
  ): Promise<WebhookEventDocument[]> {
    try {
      const docs = await this.webhookEventModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec();
      return docs;
    } catch (error) {
      console.error("Error finding webhook events:", error);
      throw new AppError(500, "Failed to fetch webhook events");
    }
  }

  /**
   * Update status of a webhook event
   */
  async updateStatus(
    eventId: string,
    status: WebhookDeliveryStatus,
  ): Promise<WebhookEventDocument | null> {
    try {
      const doc = await this.webhookEventModel
        .findOneAndUpdate(
          { eventId },
          { $set: { status } },
          { returnDocument: "after" },
        )
        .exec();
      return doc;
    } catch (error) {
      console.error("Error updating webhook status:", error);
      throw new AppError(500, "Failed to update webhook status");
    }
  }

  /**
   * Find webhook events by resource ID
   */
  async findByResourceId(
    resourceId: string,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: WebhookEventDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { resourceId };

      const [docs, total] = await Promise.all([
        this.webhookEventModel
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
      console.error("Error fetching webhook events:", error);
      throw new AppError(500, "Failed to fetch webhook events");
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
    },
  ): Promise<WebhookEventDocument> {
    try {
      const doc = await this.webhookEventModel
        .findOneAndUpdate(
          { eventId },
          {
            $push: {
              deliveryAttempts: attempt,
            },
          },
          { returnDocument: "after" },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Webhook event not found");
      }

      return doc;
    } catch (error) {
      console.error("Error adding delivery attempt:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to add delivery attempt");
    }
  }

  /**
   * Mark as delivered
   */
  async markAsDelivered(
    eventId: string,
    httpStatus: number,
    responseBody: any,
  ): Promise<WebhookEventDocument> {
    try {
      const doc = await this.webhookEventModel
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
          { returnDocument: "after" },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Webhook event not found");
      }

      return doc;
    } catch (error) {
      console.error("Error marking webhook as delivered:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to mark webhook as delivered");
    }
  }

  /**
   * Mark as failed
   */
  async markAsFailed(
    eventId: string,
    failureReason: string,
    httpStatus?: number,
    responseBody?: any,
  ): Promise<WebhookEventDocument> {
    try {
      const doc = await this.webhookEventModel
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
          { returnDocument: "after" },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Webhook event not found");
      }

      return doc;
    } catch (error) {
      console.error("Error marking webhook as failed:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to mark webhook as failed");
    }
  }

  /**
   * Append an Agenda job ID to the event's jobIds array for chain tracing
   */
  async addJobId(eventId: string, agendaJobId: string): Promise<void> {
    try {
      await this.webhookEventModel
        .updateOne({ eventId }, { $addToSet: { jobIds: agendaJobId } })
        .exec();
    } catch {
      // Non-critical — do not propagate
    }
  }

  /**
   * Append a job step failure to the event's jobErrors array
   */
  async appendJobError(eventId: string, jobError: IJobError): Promise<void> {
    try {
      await this.webhookEventModel
        .updateOne({ eventId }, { $push: { jobErrors: jobError } })
        .exec();
    } catch {
      // Non-critical — do not propagate
    }
  }

  /**
   * Schedule retry
   */
  async scheduleRetry(
    eventId: string,
    nextRetryAt: Date,
  ): Promise<WebhookEventDocument> {
    try {
      const doc = await this.webhookEventModel
        .findOneAndUpdate(
          { eventId },
          {
            $set: {
              status: WebhookDeliveryStatus.RETRY,
              nextRetryAt,
            },
          },
          { returnDocument: "after" },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Webhook event not found");
      }

      return doc;
    } catch (error) {
      console.error("Error scheduling webhook retry:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to schedule webhook retry");
    }
  }

  /**
   * Get pending webhooks ready for retry
   */
  async findPendingRetries(): Promise<WebhookEventDocument[]> {
    try {
      const docs = await this.webhookEventModel
        .find({
          status: WebhookDeliveryStatus.RETRY,
          nextRetryAt: { $lte: new Date() },
        })
        .sort({ nextRetryAt: 1 })
        .limit(100)
        .exec();

      return docs;
    } catch (error) {
      console.error("Error fetching pending retries:", error);
      throw new AppError(500, "Failed to fetch pending retries");
    }
  }

  /**
   * Get failed webhooks
   */
  async findFailed(
    tenantId: string,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: WebhookEventDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { tenantId, status: WebhookDeliveryStatus.FAILED };

      const [docs, total] = await Promise.all([
        this.webhookEventModel
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
      console.error("Error fetching failed webhooks:", error);
      throw new AppError(500, "Failed to fetch failed webhooks");
    }
  }

  /**
   * Bulk update webhook events
   */
  async bulkUpdate(
    updates: Array<{ eventId: string; data: Partial<WebhookEventDocument> }>,
  ): Promise<boolean> {
    try {
      const bulkOps = updates.map((update) => ({
        updateOne: {
          filter: { eventId: update.eventId },
          update: { $set: update.data },
        },
      }));

      const result = await this.webhookEventModel.bulkWrite(bulkOps);
      return result.modifiedCount > 0;
    } catch (error) {
      console.error("Error bulk updating webhook events:", error);
      throw new AppError(500, "Failed to bulk update webhook events");
    }
  }
}
