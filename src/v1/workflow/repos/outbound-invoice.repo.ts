import { AppError, safeSearchRegExp } from "../../../@lib";
import { ModelWrapper } from "../../../@lib/adapters/mongo/model-wrapper";
import {
  OutboundInvoiceDocument,
  OutboundInvoiceModel,
  OutboundInvoiceStatus,
  OutboundPaymentStatus,
  IOutboundPaymentDetails,
} from "../models/outbound-invoice.model";
import { WebhookEventModel } from "../../webhook/models/webhook-event.model";

export class OutboundInvoiceRepository {
  private outboundInvoiceModel: ModelWrapper<OutboundInvoiceDocument>;

  constructor() {
    this.outboundInvoiceModel = new ModelWrapper<OutboundInvoiceDocument>(
      OutboundInvoiceModel,
    );
  }

  /**
   * Build MongoDB query from where conditions
   */
  private buildOutboundInvoiceQuery(where?: any): any {
    if (!where) return {};

    const query: any = {};

    // Simple equality checks
    if (where.id?._eq) query._id = where.id._eq;
    if (where.tenantId?._eq) query.tenantId = where.tenantId._eq;
    if (where.businessId?._eq) query.businessId = where.businessId._eq;
    if (where.irn?._eq) query.irn = where.irn._eq;
    if (where.invoiceNumber?._eq) query.invoiceNumber = where.invoiceNumber._eq;
    if (where.status?._eq) query.status = where.status._eq;
    if (where.customerTIN?._eq) query.customerTIN = where.customerTIN._eq;

    // IN conditions
    if (where.status?._in) query.status = { $in: where.status._in };

    // Date range
    if (where.issueDate?._gte)
      query.issueDate = { ...query.issueDate, $gte: where.issueDate._gte };
    if (where.issueDate?._lte)
      query.issueDate = { ...query.issueDate, $lte: where.issueDate._lte };

    // Search
    if (where.search) {
      query.$or = [
        { invoiceNumber: safeSearchRegExp(where.search) },
        { customerName: safeSearchRegExp(where.search) },
        { customerTIN: safeSearchRegExp(where.search) },
        { irn: safeSearchRegExp(where.search) },
      ];
    }

    // AND conditions
    if (where._and && where._and.length > 0) {
      query.$and = where._and.map((andCondition: any) => {
        return this.buildOutboundInvoiceQuery(andCondition);
      });
    }

    return query;
  }

  /**
   * Build select projection
   */
  private buildOutboundInvoiceProjection(select?: any): any {
    return select && Object.keys(select).length > 0 ? select : null;
  }

  /**
   * Find many outbound invoices
   */
  async findMany(
    where?: any,
    select?: any,
    limit: number = 20,
    offset: number = 0,
  ): Promise<OutboundInvoiceDocument[]> {
    try {
      const query = this.buildOutboundInvoiceQuery(where);
      const projection = this.buildOutboundInvoiceProjection(select);

      const docs = await this.outboundInvoiceModel
        .find(query, projection)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .exec();

      return docs;
    } catch (error) {
      console.error("Error finding outbound invoices:", error);
      throw new AppError(500, "Failed to fetch outbound invoices");
    }
  }

  /**
   * Find one outbound invoice
   */
  async findOne(
    where: any,
    select?: any,
  ): Promise<OutboundInvoiceDocument | null> {
    try {
      const query = this.buildOutboundInvoiceQuery(where);
      const projection = this.buildOutboundInvoiceProjection(select);

      const doc = await this.outboundInvoiceModel
        .findOne(query, projection)
        .exec();

      return doc;
    } catch (error) {
      console.error("Error finding outbound invoice:", error);
      throw new AppError(500, "Failed to fetch outbound invoice");
    }
  }

  /**
   * Create a new outbound invoice
   */
  async create(
    data: Partial<OutboundInvoiceDocument>,
  ): Promise<OutboundInvoiceDocument> {
    try {
      const doc = await this.outboundInvoiceModel.create({
        ...data,
        status: OutboundInvoiceStatus.CREATED,
        workflowState: {
          transformed: false,
          validated: false,
          signed: false,
          transmitted: false,
          delivered: false,
        },
        validationAttempts: 0,
        webhookEvents: [],
      });

      return doc;
    } catch (error: any) {
      console.error("Error creating outbound invoice:", error);
      if (error.name === "ValidationError") {
        throw new AppError(400, "Invalid input");
      }
      if (error.code === 11000) {
        throw new AppError(409, "Invoice with this IRN already exists");
      }
      throw new AppError(500, "Failed to create outbound invoice");
    }
  }

  /**
   * Insert or update an invoice by IRN.
   * On first insert the workflow defaults (status, workflowState, etc.) are applied.
   * On a subsequent call the payload fields are merged without overwriting
   * existing status, webhookEvents, or workflowState.
   */
  async upsertByIrn(
    data: Partial<OutboundInvoiceDocument>,
  ): Promise<OutboundInvoiceDocument> {
    const { irn, tenantId, erpInvoiceId, source, ...mutableFields } =
      data as any;
    if (!irn) throw new AppError(400, "IRN is required for upsert");
    if (!tenantId) throw new AppError(400, "tenantId is required for upsert");

    try {
      const doc = await this.outboundInvoiceModel.findOneAndUpdate(
        { irn, tenantId },
        {
          // Only mutable fields go in $set — never identity/index fields
          $set: mutableFields,
          // Identity + defaults only applied on first insert
          $setOnInsert: {
            irn,
            tenantId,
            erpInvoiceId,
            source,
            status: OutboundInvoiceStatus.CREATED,
            workflowState: {
              transformed: false,
              validated: false,
              signed: false,
              transmitted: false,
              delivered: false,
            },
            validationAttempts: 0,
            webhookEvents: [],
          },
        },
        { upsert: true, new: true, runValidators: true },
      );

      return doc!;
    } catch (error: any) {
      console.error("Error upserting outbound invoice:", error);
      if (error.name === "ValidationError")
        throw new AppError(400, "Invalid input");
      throw new AppError(500, "Failed to upsert outbound invoice");
    }
  }

  /**
   * Update an outbound invoice
   */
  async update(
    irn: string,
    data: Partial<OutboundInvoiceDocument>,
    tenantId?: string,
  ): Promise<OutboundInvoiceDocument> {
    try {
      // Remove undefined values
      const updateData = Object.keys(data).reduce((acc, key: string) => {
        const dataKey = key as keyof OutboundInvoiceDocument;
        if (data[dataKey] !== undefined) {
          acc[key] = data[dataKey];
        }
        return acc;
      }, {} as any);

      const query: any = { irn };
      if (tenantId) query.tenantId = tenantId;

      const doc = await this.outboundInvoiceModel
        .findOneAndUpdate(
          query,
          { $set: updateData },
          { new: true, runValidators: true },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Outbound invoice not found");
      }

      return doc;
    } catch (error: any) {
      console.error("Error updating outbound invoice:", error);
      if (error.name === "ValidationError") {
        throw new AppError(400, "Invalid input");
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to update outbound invoice");
    }
  }

  /**
   * Delete an outbound invoice
   */
  async delete(irn: string, tenantId?: string): Promise<boolean> {
    try {
      const query: any = { irn };
      if (tenantId) query.tenantId = tenantId;
      const result = await this.outboundInvoiceModel
        .findOneAndDelete(query)
        .exec();

      return result !== null;
    } catch (error) {
      console.error("Error deleting outbound invoice:", error);
      throw new AppError(500, "Failed to delete outbound invoice");
    }
  }

  /**
   * Count outbound invoices
   */
  async count(where?: any): Promise<number> {
    try {
      const query = this.buildOutboundInvoiceQuery(where);
      const count = await this.outboundInvoiceModel
        .countDocuments(query)
        .exec();
      return count;
    } catch (error) {
      console.error("Error counting outbound invoices:", error);
      throw new AppError(500, "Failed to count outbound invoices");
    }
  }

  /**
   * Find outbound invoices by business ID
   */
  async findByBusinessId(
    businessId: string,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: OutboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { businessId };

      const [docs, total] = await Promise.all([
        this.outboundInvoiceModel
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.outboundInvoiceModel.countDocuments(query).exec(),
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
      console.error("Error fetching outbound invoices:", error);
      throw new AppError(500, "Failed to fetch outbound invoices");
    }
  }

  /**
   * Find outbound invoice by IRN
   */
  async findByIrn(
    irn: string,
    tenantId?: string,
  ): Promise<OutboundInvoiceDocument | null> {
    try {
      const query: any = { irn };
      if (tenantId) query.tenantId = tenantId;
      const doc = await this.outboundInvoiceModel.findOne(query).exec();
      return doc;
    } catch (error) {
      console.error("Error fetching outbound invoice:", error);
      throw new AppError(500, "Failed to fetch outbound invoice");
    }
  }

  /**
   * Find outbound invoice by invoice number
   */
  async findByInvoiceNumber(
    businessId: string,
    invoiceNumber: string,
  ): Promise<OutboundInvoiceDocument | null> {
    try {
      const doc = await this.outboundInvoiceModel
        .findOne({ businessId, invoiceNumber })
        .exec();
      return doc;
    } catch (error) {
      console.error("Error fetching outbound invoice:", error);
      throw new AppError(500, "Failed to fetch outbound invoice");
    }
  }

  /**
   * Record the most recent job failure on the invoice
   */
  async setLastJobError(
    irn: string,
    action: string,
    error: string,
  ): Promise<void> {
    try {
      await this.outboundInvoiceModel
        .updateOne(
          { irn },
          { $set: { lastJobError: { action, error, failedAt: new Date() } } },
        )
        .exec();
    } catch {
      // Non-critical — do not propagate
    }
  }

  /**
   * Update invoice status
   */
  async updateStatus(
    irn: string,
    status: OutboundInvoiceStatus,
  ): Promise<OutboundInvoiceDocument> {
    try {
      const doc = await this.outboundInvoiceModel
        .findOneAndUpdate({ irn }, { $set: { status } }, { new: true })
        .exec();

      if (!doc) {
        throw new AppError(404, "Outbound invoice not found");
      }

      return doc;
    } catch (error) {
      console.error("Error updating invoice status:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to update invoice status");
    }
  }

  /**
   * Update workflow state
   */
  async updateWorkflowState(
    irn: string,
    workflowState: Partial<{
      transformed: boolean;
      validated: boolean;
      signed: boolean;
      transmitted: boolean;
      delivered: boolean;
    }>,
  ): Promise<OutboundInvoiceDocument> {
    try {
      const updateFields: any = {};
      Object.keys(workflowState).forEach((key) => {
        updateFields[`workflowState.${key}`] =
          workflowState[key as keyof typeof workflowState];
      });

      const doc = await this.outboundInvoiceModel
        .findOneAndUpdate({ irn }, { $set: updateFields }, { new: true })
        .exec();

      if (!doc) {
        throw new AppError(404, "Outbound invoice not found");
      }

      return doc;
    } catch (error) {
      console.error("Error updating workflow state:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to update workflow state");
    }
  }

  /**
   * Add validation error
   */
  async addValidationError(
    irn: string,
    attempt: number,
    errors: string[],
    fixed: boolean = false,
  ): Promise<OutboundInvoiceDocument> {
    try {
      const doc = await this.outboundInvoiceModel
        .findOneAndUpdate(
          { irn },
          {
            $push: {
              validationErrors: {
                attempt,
                errors,
                fixed,
              },
            },
            $inc: { validationAttempts: 1 },
          },
          { new: true },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Outbound invoice not found");
      }

      return doc;
    } catch (error) {
      console.error("Error adding validation error:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to add validation error");
    }
  }

  /**
   * Link a webhook event ID to this invoice
   */
  async addWebhookEvent(
    irn: string,
    eventId: string,
  ): Promise<OutboundInvoiceDocument> {
    try {
      const doc = await this.outboundInvoiceModel
        .findOneAndUpdate(
          { irn },
          { $addToSet: { webhookEvents: eventId } },
          { new: true },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Outbound invoice not found");
      }

      return doc;
    } catch (error) {
      console.error("Error adding webhook event reference:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to add webhook event reference");
    }
  }

  /**
   * Find an outbound invoice by ERP invoice ID
   */
  async findByErpInvoiceId(
    tenantId: string,
    erpInvoiceId: string,
  ): Promise<OutboundInvoiceDocument | null> {
    try {
      return await this.outboundInvoiceModel
        .findOne({ tenantId, erpInvoiceId })
        .exec();
    } catch (error) {
      console.error("Error finding invoice by erpInvoiceId:", error);
      throw new AppError(500, "Failed to fetch outbound invoice");
    }
  }

  /**
   * Find or create an outbound invoice keyed by (tenantId, erpInvoiceId).
   * Returns the document plus a flag indicating whether it was newly created.
   */
  async findOrCreateByErpInvoiceId(
    tenantId: string,
    erpInvoiceId: string,
    defaults: Partial<OutboundInvoiceDocument>,
  ): Promise<{ doc: OutboundInvoiceDocument; created: boolean }> {
    try {
      const existing = await this.outboundInvoiceModel
        .findOne({ tenantId, erpInvoiceId })
        .exec();

      if (existing) {
        return { doc: existing, created: false };
      }

      const doc = await this.create({ ...defaults, tenantId, erpInvoiceId });
      return { doc, created: true };
    } catch (error: any) {
      // Race condition — another request created it between our find and create
      if (error.code === 11000) {
        const existing = await this.outboundInvoiceModel
          .findOne({ tenantId, erpInvoiceId })
          .exec();
        if (existing) return { doc: existing, created: false };
      }
      console.error("Error in findOrCreateByErpInvoiceId:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to find or create outbound invoice");
    }
  }

  /**
   * Update payment status and optional payment details
   */
  async updatePaymentStatus(
    irn: string,
    paymentStatus: OutboundPaymentStatus,
    paymentDetails?: IOutboundPaymentDetails,
  ): Promise<OutboundInvoiceDocument> {
    try {
      const update: any = { paymentStatus };
      if (paymentDetails) update.paymentDetails = paymentDetails;

      const doc = await this.outboundInvoiceModel
        .findOneAndUpdate({ irn }, { $set: update }, { new: true })
        .exec();

      if (!doc) throw new AppError(404, "Outbound invoice not found");
      return doc;
    } catch (error) {
      console.error("Error updating payment status:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update payment status");
    }
  }

  /**
   * Find an invoice by IRN and populate the full WebhookEvent documents
   * for each eventId stored in invoice.webhookEvents.
   */
  async findByIrnWithWebhookEvents(
    irn: string,
    tenantId?: string,
  ): Promise<{
    invoice: OutboundInvoiceDocument;
    webhookEvents: any[];
  } | null> {
    try {
      const query: any = { irn };
      if (tenantId) query.tenantId = tenantId;
      const invoice = await this.outboundInvoiceModel.findOne(query).exec();
      if (!invoice) return null;

      const eventIds: string[] = invoice.webhookEvents ?? [];
      const webhookEvents =
        eventIds.length > 0
          ? await WebhookEventModel.find({ eventId: { $in: eventIds } })
              .sort({ createdAt: 1 })
              .exec()
          : [];

      return { invoice, webhookEvents };
    } catch (error) {
      console.error("Error fetching invoice with webhook events:", error);
      throw new AppError(500, "Failed to fetch invoice details");
    }
  }

  /**
   * Search outbound invoices
   */
  async searchOutboundInvoices(
    searchQuery: string,
    businessId: string,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: OutboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;

      const query: any = {
        businessId,
        $or: [
          { invoiceNumber: safeSearchRegExp(searchQuery) },
          { customerName: safeSearchRegExp(searchQuery) },
          { customerTIN: safeSearchRegExp(searchQuery) },
          { irn: safeSearchRegExp(searchQuery) },
        ],
      };

      const [docs, total] = await Promise.all([
        this.outboundInvoiceModel
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.outboundInvoiceModel.countDocuments(query).exec(),
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
      console.error("Error searching outbound invoices:", error);
      throw new AppError(500, "Failed to search outbound invoices");
    }
  }

  /**
   * Get invoices by status
   */
  async findByStatus(
    businessId: string,
    status: OutboundInvoiceStatus,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: OutboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { businessId, status };

      const [docs, total] = await Promise.all([
        this.outboundInvoiceModel
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.outboundInvoiceModel.countDocuments(query).exec(),
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
      console.error("Error fetching invoices by status:", error);
      throw new AppError(500, "Failed to fetch invoices");
    }
  }

  /**
   * Get failed invoices
   */
  async findFailed(
    businessId: string,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: OutboundInvoiceDocument[]; meta: any }> {
    return this.findByStatus(
      businessId,
      OutboundInvoiceStatus.FAILED,
      limit,
      page,
    );
  }

  /**
   * Bulk update invoices
   */
  async bulkUpdate(
    updates: Array<{ irn: string; data: Partial<OutboundInvoiceDocument> }>,
  ): Promise<boolean> {
    try {
      const bulkOps = updates.map((update) => ({
        updateOne: {
          filter: { irn: update.irn },
          update: { $set: update.data },
        },
      }));

      const result = await this.outboundInvoiceModel.bulkWrite(bulkOps);
      return result.modifiedCount > 0;
    } catch (error) {
      console.error("Error bulk updating outbound invoices:", error);
      throw new AppError(500, "Failed to bulk update outbound invoices");
    }
  }
}
