import { AppError } from '../../../@lib';
import { ModelWrapper } from '../../../@lib/adapters/mongo/model-wrapper';
import {
  InboundInvoiceDocument,
  InboundInvoiceModel,
  InboundInvoiceStatus,
  PaymentStatus,
} from '../models/inbound-invoice.model';

export class InboundInvoiceRepository {
  private inboundInvoiceModel: ModelWrapper<InboundInvoiceDocument>;

  constructor() {
    this.inboundInvoiceModel = new ModelWrapper<InboundInvoiceDocument>(InboundInvoiceModel);
  }

  /**
   * Build MongoDB query from where conditions
   */
  private buildInboundInvoiceQuery(where?: any): any {
    if (!where) return {};

    const query: any = {};

    // Simple equality checks
    if (where.id?._eq) query._id = where.id._eq;
    if (where.tenantId?._eq) query.tenantId = where.tenantId._eq;
    if (where.businessId?._eq) query.businessId = where.businessId._eq;
    if (where.irn?._eq) query.irn = where.irn._eq;
    if (where.invoiceNumber?._eq) query.invoiceNumber = where.invoiceNumber._eq;
    if (where.status?._eq) query.status = where.status._eq;
    if (where.supplierTIN?._eq) query.supplierTIN = where.supplierTIN._eq;
    if (where.paymentStatus?._eq) query['payment.paymentStatus'] = where.paymentStatus._eq;

    // IN conditions
    if (where.status?._in) query.status = { $in: where.status._in };
    if (where.paymentStatus?._in) query['payment.paymentStatus'] = { $in: where.paymentStatus._in };

    // Date range
    if (where.issueDate?._gte) query.issueDate = { ...query.issueDate, $gte: where.issueDate._gte };
    if (where.issueDate?._lte) query.issueDate = { ...query.issueDate, $lte: where.issueDate._lte };
    if (where.dueDate?._gte) query.dueDate = { ...query.dueDate, $gte: where.dueDate._gte };
    if (where.dueDate?._lte) query.dueDate = { ...query.dueDate, $lte: where.dueDate._lte };

    // Search
    if (where.search) {
      query.$or = [
        { invoiceNumber: new RegExp(where.search, 'i') },
        { supplierName: new RegExp(where.search, 'i') },
        { supplierTIN: new RegExp(where.search, 'i') },
        { irn: new RegExp(where.search, 'i') },
      ];
    }

    // AND conditions
    if (where._and && where._and.length > 0) {
      query.$and = where._and.map((andCondition: any) => {
        return this.buildInboundInvoiceQuery(andCondition);
      });
    }

    return query;
  }

  /**
   * Build select projection
   */
  private buildInboundInvoiceProjection(select?: any): any {
    return select && Object.keys(select).length > 0 ? select : null;
  }

  /**
   * Find many inbound invoices
   */
  async findMany(
    where?: any,
    select?: any,
    limit: number = 20,
    offset: number = 0
  ): Promise<InboundInvoiceDocument[]> {
    try {
      const query = this.buildInboundInvoiceQuery(where);
      const projection = this.buildInboundInvoiceProjection(select);

      const docs = await this.inboundInvoiceModel
        .find(query, projection)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .exec();

      return docs;
    } catch (error) {
      console.error('Error finding inbound invoices:', error);
      throw new AppError(500, 'Failed to fetch inbound invoices');
    }
  }

  /**
   * Find one inbound invoice
   */
  async findOne(where: any, select?: any): Promise<InboundInvoiceDocument | null> {
    try {
      const query = this.buildInboundInvoiceQuery(where);
      const projection = this.buildInboundInvoiceProjection(select);

      const doc = await this.inboundInvoiceModel.base.findOne(query, projection).exec();

      return doc;
    } catch (error) {
      console.error('Error finding inbound invoice:', error);
      throw new AppError(500, 'Failed to fetch inbound invoice');
    }
  }

  /**
   * Create a new inbound invoice
   */
  async create(data: Partial<InboundInvoiceDocument>): Promise<InboundInvoiceDocument> {
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
      console.error('Error creating inbound invoice:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error.code === 11000) {
        throw new AppError(409, 'Invoice with this IRN already exists');
      }
      throw new AppError(500, 'Failed to create inbound invoice');
    }
  }

  /**
   * Update an inbound invoice
   */
  async update(
    irn: string,
    data: Partial<InboundInvoiceDocument>
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

      const doc = await this.inboundInvoiceModel.base
        .findOneAndUpdate({ irn }, { $set: updateData }, { new: true, runValidators: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'Inbound invoice not found');
      }

      return doc;
    } catch (error: any) {
      console.error('Error updating inbound invoice:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to update inbound invoice');
    }
  }

  /**
   * Delete an inbound invoice
   */
  async delete(irn: string): Promise<boolean> {
    try {
      const result = await this.inboundInvoiceModel.base.findOneAndDelete({ irn }).exec();

      return result !== null;
    } catch (error) {
      console.error('Error deleting inbound invoice:', error);
      throw new AppError(500, 'Failed to delete inbound invoice');
    }
  }

  /**
   * Count inbound invoices
   */
  async count(where?: any): Promise<number> {
    try {
      const query = this.buildInboundInvoiceQuery(where);
      const count = await this.inboundInvoiceModel.countDocuments(query).exec();
      return count;
    } catch (error) {
      console.error('Error counting inbound invoices:', error);
      throw new AppError(500, 'Failed to count inbound invoices');
    }
  }

  /**
   * Find inbound invoices by business ID
   */
  async findByBusinessId(
    businessId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: InboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { businessId };

      const [docs, total] = await Promise.all([
        this.inboundInvoiceModel.base
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
      console.error('Error fetching inbound invoices:', error);
      throw new AppError(500, 'Failed to fetch inbound invoices');
    }
  }

  /**
   * Find inbound invoice by IRN
   */
  async findByIRN(irn: string): Promise<InboundInvoiceDocument | null> {
    try {
      const doc = await this.inboundInvoiceModel.base.findOne({ irn }).exec();
      return doc;
    } catch (error) {
      console.error('Error fetching inbound invoice:', error);
      throw new AppError(500, 'Failed to fetch inbound invoice');
    }
  }

  /**
   * Find inbound invoice by invoice number
   */
  async findByInvoiceNumber(
    businessId: string,
    invoiceNumber: string
  ): Promise<InboundInvoiceDocument | null> {
    try {
      const doc = await this.inboundInvoiceModel.base
        .findOne({ businessId, invoiceNumber })
        .exec();
      return doc;
    } catch (error) {
      console.error('Error fetching inbound invoice:', error);
      throw new AppError(500, 'Failed to fetch inbound invoice');
    }
  }

  /**
   * Update invoice status
   */
  async updateStatus(
    irn: string,
    status: InboundInvoiceStatus
  ): Promise<InboundInvoiceDocument> {
    try {
      const doc = await this.inboundInvoiceModel.base
        .findOneAndUpdate({ irn }, { $set: { status } }, { new: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'Inbound invoice not found');
      }

      return doc;
    } catch (error) {
      console.error('Error updating invoice status:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to update invoice status');
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
    }>
  ): Promise<InboundInvoiceDocument> {
    try {
      const updateFields: any = {};
      Object.keys(workflowState).forEach((key) => {
        updateFields[`workflowState.${key}`] = workflowState[key as keyof typeof workflowState];
      });

      const doc = await this.inboundInvoiceModel.base
        .findOneAndUpdate({ irn }, { $set: updateFields }, { new: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'Inbound invoice not found');
      }

      return doc;
    } catch (error) {
      console.error('Error updating workflow state:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to update workflow state');
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
    }
  ): Promise<InboundInvoiceDocument> {
    try {
      const updateData: any = { paymentStatus };

      if (paymentDetails) {
        updateData.paymentDetails = paymentDetails;
      }

      const doc = await this.inboundInvoiceModel.base
        .findOneAndUpdate({ irn }, { $set: updateData }, { new: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'Inbound invoice not found');
      }

      return doc;
    } catch (error) {
      console.error('Error updating payment information:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to update payment information');
    }
  }

  /**
   * Reject invoice
   */
  async reject(
    irn: string,
    rejectionReason: string,
    rejectedBy: string
  ): Promise<InboundInvoiceDocument> {
    try {
      const doc = await this.inboundInvoiceModel.base
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
          { new: true }
        )
        .exec();

      if (!doc) {
        throw new AppError(404, 'Inbound invoice not found');
      }

      return doc;
    } catch (error) {
      console.error('Error rejecting invoice:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to reject invoice');
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
    }
  ): Promise<InboundInvoiceDocument> {
    try {
      const doc = await this.inboundInvoiceModel.base
        .findOneAndUpdate(
          { irn },
          {
            $push: {
              webhookEvents: event,
            },
          },
          { new: true }
        )
        .exec();

      if (!doc) {
        throw new AppError(404, 'Inbound invoice not found');
      }

      return doc;
    } catch (error) {
      console.error('Error adding webhook event:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to add webhook event');
    }
  }

  /**
   * Search inbound invoices
   */
  async searchInboundInvoices(
    searchQuery: string,
    businessId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: InboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;

      const query: any = {
        businessId,
        $or: [
          { invoiceNumber: new RegExp(searchQuery, 'i') },
          { supplierName: new RegExp(searchQuery, 'i') },
          { supplierTIN: new RegExp(searchQuery, 'i') },
          { irn: new RegExp(searchQuery, 'i') },
        ],
      };

      const [docs, total] = await Promise.all([
        this.inboundInvoiceModel.base
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
      console.error('Error searching inbound invoices:', error);
      throw new AppError(500, 'Failed to search inbound invoices');
    }
  }

  /**
   * Get invoices by status
   */
  async findByStatus(
    businessId: string,
    status: InboundInvoiceStatus,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: InboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { businessId, status };

      const [docs, total] = await Promise.all([
        this.inboundInvoiceModel.base
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
      console.error('Error fetching invoices by status:', error);
      throw new AppError(500, 'Failed to fetch invoices');
    }
  }

  /**
   * Get invoices by payment status
   */
  async findByPaymentStatus(
    businessId: string,
    paymentStatus: PaymentStatus,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: InboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { businessId, paymentStatus };

      const [docs, total] = await Promise.all([
        this.inboundInvoiceModel.base
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
      console.error('Error fetching invoices by payment status:', error);
      throw new AppError(500, 'Failed to fetch invoices');
    }
  }

  /**
   * Get overdue invoices
   */
  async findOverdue(
    businessId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: InboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = {
        businessId,
        dueDate: { $lt: new Date() },
        paymentStatus: { $in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
      };

      const [docs, total] = await Promise.all([
        this.inboundInvoiceModel.base
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
      console.error('Error fetching overdue invoices:', error);
      throw new AppError(500, 'Failed to fetch overdue invoices');
    }
  }

  /**
   * Bulk update invoices
   */
  async bulkUpdate(
    updates: Array<{ irn: string; data: Partial<InboundInvoiceDocument> }>
  ): Promise<boolean> {
    try {
      const bulkOps = updates.map((update) => ({
        updateOne: {
          filter: { irn: update.irn },
          update: { $set: update.data },
        },
      }));

      const result = await this.inboundInvoiceModel.base.bulkWrite(bulkOps);
      return result.modifiedCount > 0;
    } catch (error) {
      console.error('Error bulk updating inbound invoices:', error);
      throw new AppError(500, 'Failed to bulk update inbound invoices');
    }
  }
}
 