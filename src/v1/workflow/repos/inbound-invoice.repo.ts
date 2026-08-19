import { AppError, safeSearchRegExp } from "../../../@lib";
import { ModelWrapper } from "../../../@lib/adapters/mongo/model-wrapper";
import {
  InboundInvoiceDocument,
  InboundInvoiceModel,
  InboundInvoiceStatus,
  PaymentStatus,
} from "../models/inbound-invoice.model";

export class InboundInvoiceRepository {
  private inboundInvoiceModel: ModelWrapper<InboundInvoiceDocument>;

  constructor() {
    this.inboundInvoiceModel = new ModelWrapper<InboundInvoiceDocument>(
      InboundInvoiceModel,
    );
  }

  /**
   * Build MongoDB query from where conditions
   */
  private buildInboundInvoiceQuery(where?: any): any {
    if (!where || typeof where !== "object") return {};

    const query: any = {};

    for (const [key, value] of Object.entries(where)) {
      if (key === "_and" && Array.isArray(value)) {
        query.$and = value.map((cond) => this.buildInboundInvoiceQuery(cond));
      } else if (key === "_or" && Array.isArray(value)) {
        query.$or = value.map((cond) => this.buildInboundInvoiceQuery(cond));
      } else if (key === "search" && typeof value === "string") {
        query.$or = [
          { invoiceNumber: safeSearchRegExp(value) },
          { supplierName: safeSearchRegExp(value) },
          { supplierTIN: safeSearchRegExp(value) },
          { irn: safeSearchRegExp(value) },
        ];
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
          const targetKey =
            key === "id"
              ? "_id"
              : key === "paymentStatus"
                ? "payment.paymentStatus"
                : key;

          if (valObj._eq !== undefined) {
            query[targetKey] = valObj._eq;
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

          query[targetKey] = fieldQuery;
        } else {
          query[key === "id" ? "_id" : key] = value;
        }
      } else {
        query[key === "id" ? "_id" : key] = value;
      }
    }

    return query;
  }

  /**
   * Build select projection
   */
  private buildInboundInvoiceProjection(select?: any): any {
    if (select && Object.keys(select).length > 0) {
      return select;
    }
    return { decryptedData: 0 };
  }

  /**
   * Find many inbound invoices
   */
  async findMany(
    where?: any,
    select?: any,
    limit: number = 20,
    offset: number = 0,
  ): Promise<InboundInvoiceDocument[]> {
    try {
      const query = this.buildInboundInvoiceQuery(where);
      const projection = this.buildInboundInvoiceProjection(select);

      const docs = await this.inboundInvoiceModel
        .find(query, projection)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .maxTimeMS(20000)
        .lean()
        .exec();

      return docs as unknown as InboundInvoiceDocument[];
    } catch (error) {
      console.error("Error finding inbound invoices:", error);
      throw new AppError(500, "Failed to fetch inbound invoices");
    }
  }

  /**
   * Find one inbound invoice
   */
  async findOne(
    where: any,
    select?: any,
  ): Promise<InboundInvoiceDocument | null> {
    try {
      const query = this.buildInboundInvoiceQuery(where);
      const projection = this.buildInboundInvoiceProjection(select);

      const doc = await this.inboundInvoiceModel
        .findOne(query, projection)
        .exec();

      return doc;
    } catch (error) {
      console.error("Error finding inbound invoice:", error);
      throw new AppError(500, "Failed to fetch inbound invoice");
    }
  }

  /**
   * Create a new inbound invoice
   */
  async create(
    data: Partial<InboundInvoiceDocument>,
  ): Promise<InboundInvoiceDocument> {
    try {
      const doc = await this.inboundInvoiceModel.create({
        ...data,
        status: InboundInvoiceStatus.TRANSMITTED,
        workflowState: {
          notified: false,
          acknowledged: false,
          downloaded: false,
          synced: false,
          paymentUpdated: false,
        },
        paymentStatus: PaymentStatus.PENDING,
        webhookEvents: [],
      });

      return doc;
    } catch (error: any) {
      console.error("Error creating inbound invoice:", error);
      if (error.name === "ValidationError") {
        throw new AppError(400, error);
      }
      if (error.code === 11000) {
        throw new AppError(409, "Invoice with this IRN already exists");
      }
      throw new AppError(500, "Failed to create inbound invoice");
    }
  }

  /**
   * Update an inbound invoice
   */
  async update(
    irn: string,
    data: Partial<InboundInvoiceDocument>,
  ): Promise<InboundInvoiceDocument> {
    try {
      // Remove undefined values
      const updateData = Object.keys(data).reduce((acc, key: string) => {
        const dataKey = key as keyof InboundInvoiceDocument;
        if (data[dataKey] !== undefined) {
          acc[key] = data[dataKey];
        }
        return acc;
      }, {} as any);

      const doc = await this.inboundInvoiceModel
        .findOneAndUpdate(
          { irn },
          { $set: updateData },
          { returnDocument: "after", runValidators: true },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Inbound invoice not found");
      }

      return doc;
    } catch (error: any) {
      console.error("Error updating inbound invoice:", error);
      if (error.name === "ValidationError") {
        throw new AppError(400, error);
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to update inbound invoice");
    }
  }

  /**
   * Delete an inbound invoice
   */
  async delete(irn: string): Promise<boolean> {
    try {
      const result = await this.inboundInvoiceModel
        .findOneAndDelete({ irn })
        .exec();

      return result !== null;
    } catch (error) {
      console.error("Error deleting inbound invoice:", error);
      throw new AppError(500, "Failed to delete inbound invoice");
    }
  }

  /**
   * Count inbound invoices
   */
  async count(where?: any): Promise<number> {
    try {
      const query = this.buildInboundInvoiceQuery(where);
      const count = await this.inboundInvoiceModel
        .countDocuments(query)
        .maxTimeMS(20000)
        .exec();
      return count;
    } catch (error) {
      console.error("Error counting inbound invoices:", error);
      return 0;
    }
  }

  /**
   * Find inbound invoices by business ID
   */
  async findByBusinessId(
    businessId: string,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: InboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { businessId };

      const [docs, total] = await Promise.all([
        this.inboundInvoiceModel
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.inboundInvoiceModel.countDocuments(query).exec(),
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
      console.error("Error fetching inbound invoices:", error);
      throw new AppError(500, "Failed to fetch inbound invoices");
    }
  }

  /**
   * Find inbound invoice by IRN
   */
  async findByIRN(
    irn: string,
    tenantId?: string,
    businessId?: string,
  ): Promise<InboundInvoiceDocument | null> {
    try {
      const query: any = { irn };
      if (tenantId) query.tenantId = tenantId;
      if (businessId) query.businessId = businessId;
      const doc = await this.inboundInvoiceModel.findOne(query).exec();
      return doc;
    } catch (error) {
      console.error("Error fetching inbound invoice:", error);
      throw new AppError(500, "Failed to fetch inbound invoice");
    }
  }

  /**
   * Find inbound invoice by invoice number
   */
  async findByInvoiceNumber(
    businessId: string,
    invoiceNumber: string,
  ): Promise<InboundInvoiceDocument | null> {
    try {
      const doc = await this.inboundInvoiceModel
        .findOne({ businessId, invoiceNumber })
        .exec();
      return doc;
    } catch (error) {
      console.error("Error fetching inbound invoice:", error);
      throw new AppError(500, "Failed to fetch inbound invoice");
    }
  }

  /**
   * Update invoice status
   */
  async updateStatus(
    irn: string,
    status: InboundInvoiceStatus,
  ): Promise<InboundInvoiceDocument> {
    try {
      const doc = await this.inboundInvoiceModel
        .findOneAndUpdate(
          { irn },
          { $set: { status } },
          { returnDocument: "after" },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Inbound invoice not found");
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
      notified: boolean;
      acknowledged: boolean;
      downloaded: boolean;
      synced: boolean;
      paymentUpdated: boolean;
    }>,
  ): Promise<InboundInvoiceDocument> {
    try {
      const updateFields: any = {};
      Object.keys(workflowState).forEach((key) => {
        updateFields[`workflowState.${key}`] =
          workflowState[key as keyof typeof workflowState];
      });

      const doc = await this.inboundInvoiceModel
        .findOneAndUpdate(
          { irn },
          { $set: updateFields },
          { returnDocument: "after" },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Inbound invoice not found");
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
   * Update payment information
   */
  async updatePayment(
    irn: string,
    paymentStatus: PaymentStatus,
    paymentDetails?: {
      paymentDate?: Date;
      paymentMethod?: string;
      transactionReference?: string;
      amountPaid?: number;
    },
  ): Promise<InboundInvoiceDocument> {
    try {
      const updateData: any = { paymentStatus };

      if (paymentDetails) {
        updateData.paymentDetails = paymentDetails;
      }

      const doc = await this.inboundInvoiceModel
        .findOneAndUpdate(
          { irn },
          { $set: updateData },
          { returnDocument: "after" },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Inbound invoice not found");
      }

      return doc;
    } catch (error) {
      console.error("Error updating payment information:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to update payment information");
    }
  }

  /**
   * Reject invoice
   */
  async reject(
    irn: string,
    rejectionReason: string,
    rejectedBy: string,
  ): Promise<InboundInvoiceDocument> {
    try {
      const doc = await this.inboundInvoiceModel
        .findOneAndUpdate(
          { irn },
          {
            $set: {
              status: InboundInvoiceStatus.REJECTED,
              rejectionReason,
              rejectedBy,
              rejectedAt: new Date(),
            },
          },
          { returnDocument: "after" },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Inbound invoice not found");
      }

      return doc;
    } catch (error) {
      console.error("Error rejecting invoice:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to reject invoice");
    }
  }

  /**
   * Add webhook event
   */
  async addWebhookEvent(
    irn: string,
    event: {
      eventType: string;
      timestamp: Date;
      payload: any;
      response?: any;
      success: boolean;
    },
  ): Promise<InboundInvoiceDocument> {
    try {
      const doc = await this.inboundInvoiceModel
        .findOneAndUpdate(
          { irn },
          {
            $push: {
              webhookEvents: event,
            },
          },
          { returnDocument: "after" },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Inbound invoice not found");
      }

      return doc;
    } catch (error) {
      console.error("Error adding webhook event:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to add webhook event");
    }
  }

  /**
   * Search inbound invoices
   */
  async searchInboundInvoices(
    searchQuery: string,
    businessId: string,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: InboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;

      const query: any = {
        businessId,
        $or: [
          { invoiceNumber: safeSearchRegExp(searchQuery) },
          { supplierName: safeSearchRegExp(searchQuery) },
          { supplierTIN: safeSearchRegExp(searchQuery) },
          { irn: safeSearchRegExp(searchQuery) },
        ],
      };

      const [docs, total] = await Promise.all([
        this.inboundInvoiceModel
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.inboundInvoiceModel.countDocuments(query).exec(),
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
      console.error("Error searching inbound invoices:", error);
      throw new AppError(500, "Failed to search inbound invoices");
    }
  }

  /**
   * Get invoices by status
   */
  async findByStatus(
    businessId: string,
    status: InboundInvoiceStatus,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: InboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { businessId, status };

      const [docs, total] = await Promise.all([
        this.inboundInvoiceModel
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.inboundInvoiceModel.countDocuments(query).exec(),
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
   * Get invoices by payment status
   */
  async findByPaymentStatus(
    businessId: string,
    paymentStatus: PaymentStatus,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: InboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { businessId, paymentStatus };

      const [docs, total] = await Promise.all([
        this.inboundInvoiceModel
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.inboundInvoiceModel.countDocuments(query).exec(),
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
      console.error("Error fetching invoices by payment status:", error);
      throw new AppError(500, "Failed to fetch invoices");
    }
  }

  /**
   * Get overdue invoices
   */
  async findOverdue(
    businessId: string,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: InboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = {
        businessId,
        dueDate: { $lt: new Date() },
        paymentStatus: { $in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
      };

      const [docs, total] = await Promise.all([
        this.inboundInvoiceModel
          .find(query)
          .sort({ dueDate: 1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.inboundInvoiceModel.countDocuments(query).exec(),
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
      console.error("Error fetching overdue invoices:", error);
      throw new AppError(500, "Failed to fetch overdue invoices");
    }
  }

  /**
   * Bulk update invoices
   */
  async bulkUpdate(
    updates: Array<{ irn: string; data: Partial<InboundInvoiceDocument> }>,
  ): Promise<boolean> {
    try {
      const bulkOps = updates.map((update) => ({
        updateOne: {
          filter: { irn: update.irn },
          update: { $set: update.data },
        },
      }));

      const result = await this.inboundInvoiceModel.bulkWrite(bulkOps);
      return result.modifiedCount > 0;
    } catch (error) {
      console.error("Error bulk updating inbound invoices:", error);
      throw new AppError(500, "Failed to bulk update inbound invoices");
    }
  }
}
