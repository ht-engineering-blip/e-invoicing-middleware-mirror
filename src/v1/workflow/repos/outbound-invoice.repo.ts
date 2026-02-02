import { AppError } from '../../../@lib';
import { ModelWrapper } from '../../../@lib/adapters/mongo/model-wrapper';
import {
  OutboundInvoiceDocument,
  OutboundInvoiceModel,
  OutboundInvoiceStatus,
} from '../models/outbound-invoice.model';

export class OutboundInvoiceRepository {
  private outboundInvoiceModel: ModelWrapper<OutboundInvoiceDocument>;

  constructor() {
    this.outboundInvoiceModel = new ModelWrapper<OutboundInvoiceDocument>(OutboundInvoiceModel);
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
    if (where.issueDate?._gte) query.issueDate = { ...query.issueDate, $gte: where.issueDate._gte };
    if (where.issueDate?._lte) query.issueDate = { ...query.issueDate, $lte: where.issueDate._lte };

    // Search
    if (where.search) {
      query.$or = [
        { invoiceNumber: new RegExp(where.search, 'i') },
        { customerName: new RegExp(where.search, 'i') },
        { customerTIN: new RegExp(where.search, 'i') },
        { irn: new RegExp(where.search, 'i') },
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
    offset: number = 0
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
      console.error('Error finding outbound invoices:', error);
      throw new AppError(500, 'Failed to fetch outbound invoices');
    }
  }

  /**
   * Find one outbound invoice
   */
  async findOne(where: any, select?: any): Promise<OutboundInvoiceDocument | null> {
    try {
      const query = this.buildOutboundInvoiceQuery(where);
      const projection = this.buildOutboundInvoiceProjection(select);

      const doc = await this.outboundInvoiceModel.base.findOne(query, projection).exec();

      return doc;
    } catch (error) {
      console.error('Error finding outbound invoice:', error);
      throw new AppError(500, 'Failed to fetch outbound invoice');
    }
  }

  /**
   * Create a new outbound invoice
   */
  async create(data: Partial<OutboundInvoiceDocument>): Promise<OutboundInvoiceDocument> {
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
      console.error('Error creating outbound invoice:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error.code === 11000) {
        throw new AppError(409, 'Invoice with this IRN already exists');
      }
      throw new AppError(500, 'Failed to create outbound invoice');
    }
  }

  /**
   * Update an outbound invoice
   */
  async update(
    irn: string,
    data: Partial<OutboundInvoiceDocument>
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

      const doc = await this.outboundInvoiceModel.base
        .findOneAndUpdate({ irn }, { $set: updateData }, { new: true, runValidators: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'Outbound invoice not found');
      }

      return doc;
    } catch (error: any) {
      console.error('Error updating outbound invoice:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to update outbound invoice');
    }
  }

  /**
   * Delete an outbound invoice
   */
  async delete(irn: string): Promise<boolean> {
    try {
      const result = await this.outboundInvoiceModel.base.findOneAndDelete({ irn }).exec();

      return result !== null;
    } catch (error) {
      console.error('Error deleting outbound invoice:', error);
      throw new AppError(500, 'Failed to delete outbound invoice');
    }
  }

  /**
   * Count outbound invoices
   */
  async count(where?: any): Promise<number> {
    try {
      const query = this.buildOutboundInvoiceQuery(where);
      const count = await this.outboundInvoiceModel.countDocuments(query).exec();
      return count;
    } catch (error) {
      console.error('Error counting outbound invoices:', error);
      throw new AppError(500, 'Failed to count outbound invoices');
    }
  }

  /**
   * Find outbound invoices by business ID
   */
  async findByBusinessId(
    businessId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: OutboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { businessId };

      const [docs, total] = await Promise.all([
        this.outboundInvoiceModel.base
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
      console.error('Error fetching outbound invoices:', error);
      throw new AppError(500, 'Failed to fetch outbound invoices');
    }
  }

  /**
   * Find outbound invoice by IRN
   */
  async findByIrn(irn: string): Promise<OutboundInvoiceDocument | null> {
    try {
      const doc = await this.outboundInvoiceModel.base.findOne({ irn }).exec();
      return doc;
    } catch (error) {
      console.error('Error fetching outbound invoice:', error);
      throw new AppError(500, 'Failed to fetch outbound invoice');
    }
  }

  /**
   * Find outbound invoice by invoice number
   */
  async findByInvoiceNumber(
    businessId: string,
    invoiceNumber: string
  ): Promise<OutboundInvoiceDocument | null> {
    try {
      const doc = await this.outboundInvoiceModel.base
        .findOne({ businessId, invoiceNumber })
        .exec();
      return doc;
    } catch (error) {
      console.error('Error fetching outbound invoice:', error);
      throw new AppError(500, 'Failed to fetch outbound invoice');
    }
  }

  /**
   * Update invoice status
   */
  async updateStatus(
    irn: string,
    status: OutboundInvoiceStatus
  ): Promise<OutboundInvoiceDocument> {
    try {
      const doc = await this.outboundInvoiceModel.base
        .findOneAndUpdate({ irn }, { $set: { status } }, { new: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'Outbound invoice not found');
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
      transformed: boolean;
      validated: boolean;
      signed: boolean;
      transmitted: boolean;
      delivered: boolean;
    }>
  ): Promise<OutboundInvoiceDocument> {
    try {
      const updateFields: any = {};
      Object.keys(workflowState).forEach((key) => {
        updateFields[`workflowState.${key}`] = workflowState[key as keyof typeof workflowState];
      });

      const doc = await this.outboundInvoiceModel.base
        .findOneAndUpdate({ irn }, { $set: updateFields }, { new: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'Outbound invoice not found');
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
   * Add validation error
   */
  async addValidationError(
    irn: string,
    attempt: number,
    errors: string[],
    fixed: boolean = false
  ): Promise<OutboundInvoiceDocument> {
    try {
      const doc = await this.outboundInvoiceModel.base
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
          { new: true }
        )
        .exec();

      if (!doc) {
        throw new AppError(404, 'Outbound invoice not found');
      }

      return doc;
    } catch (error) {
      console.error('Error adding validation error:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to add validation error');
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
  ): Promise<OutboundInvoiceDocument> {
    try {
      const doc = await this.outboundInvoiceModel.base
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
        throw new AppError(404, 'Outbound invoice not found');
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
   * Search outbound invoices
   */
  async searchOutboundInvoices(
    searchQuery: string,
    businessId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: OutboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;

      const query: any = {
        businessId,
        $or: [
          { invoiceNumber: new RegExp(searchQuery, 'i') },
          { customerName: new RegExp(searchQuery, 'i') },
          { customerTIN: new RegExp(searchQuery, 'i') },
          { irn: new RegExp(searchQuery, 'i') },
        ],
      };

      const [docs, total] = await Promise.all([
        this.outboundInvoiceModel.base
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
      console.error('Error searching outbound invoices:', error);
      throw new AppError(500, 'Failed to search outbound invoices');
    }
  }

  /**
   * Get invoices by status
   */
  async findByStatus(
    businessId: string,
    status: OutboundInvoiceStatus,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: OutboundInvoiceDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { businessId, status };

      const [docs, total] = await Promise.all([
        this.outboundInvoiceModel.base
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
      console.error('Error fetching invoices by status:', error);
      throw new AppError(500, 'Failed to fetch invoices');
    }
  }

  /**
   * Get failed invoices
   */
  async findFailed(
    businessId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: OutboundInvoiceDocument[]; meta: any }> {
    return this.findByStatus(businessId, OutboundInvoiceStatus.FAILED, limit, page);
  }

  /**
   * Bulk update invoices
   */
  async bulkUpdate(
    updates: Array<{ irn: string; data: Partial<OutboundInvoiceDocument> }>
  ): Promise<boolean> {
    try {
      const bulkOps = updates.map((update) => ({
        updateOne: {
          filter: { irn: update.irn },
          update: { $set: update.data },
        },
      }));

      const result = await this.outboundInvoiceModel.base.bulkWrite(bulkOps);
      return result.modifiedCount > 0;
    } catch (error) {
      console.error('Error bulk updating outbound invoices:', error);
      throw new AppError(500, 'Failed to bulk update outbound invoices');
    }
  }
}
