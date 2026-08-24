import { AppError, safeSearchRegExp } from "../../../@lib";
import { ModelWrapper } from "../../../@lib/adapters/mongo/model-wrapper";
import {
  OutboundInvoiceDocument,
  OutboundInvoiceModel,
  OutboundInvoiceStatus,
  OutboundPaymentStatus,
  IOutboundPaymentDetails,
} from "../models/outbound-invoice.model";
import {
  InboundInvoiceDocument,
  InboundInvoiceModel,
} from "../models/inbound-invoice.model";
import { WebhookEventModel } from "../../webhook/models/webhook-event.model";

export class OutboundInvoiceRepository {
  private outboundInvoiceModel: ModelWrapper<OutboundInvoiceDocument>;
  private inboundInvoiceModel: ModelWrapper<InboundInvoiceDocument>;

  constructor() {
    this.outboundInvoiceModel = new ModelWrapper<OutboundInvoiceDocument>(
      OutboundInvoiceModel,
    );
    this.inboundInvoiceModel = new ModelWrapper<InboundInvoiceDocument>(
      InboundInvoiceModel,
    );
  }

  /**
   * Build MongoDB query from where conditions
   */
  private buildOutboundInvoiceQuery(where?: any): any {
    if (!where || typeof where !== "object") return {};

    const query: any = {};

    for (const [key, value] of Object.entries(where)) {
      if (key === "_and" && Array.isArray(value)) {
        query.$and = value.map((cond) => this.buildOutboundInvoiceQuery(cond));
      } else if (key === "_or" && Array.isArray(value)) {
        query.$or = value.map((cond) => this.buildOutboundInvoiceQuery(cond));
      } else if (key === "search" && typeof value === "string") {
        query.$or = [
          { invoiceNumber: safeSearchRegExp(value) },
          { customerName: safeSearchRegExp(value) },
          { customerTIN: safeSearchRegExp(value) },
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

          query[key === "id" ? "_id" : key] = fieldQuery;
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
  private buildOutboundInvoiceProjection(select?: any): any {
    if (select && Object.keys(select).length > 0) {
      return select;
    }
    return {
      rawPayload: 0,
      encryptedData: 0,
      decryptedData: 0,
      signedXml: 0,
    };
  }

  /**
   * Unified Aggregation Pipeline across outbound, inbound, or both invoice streams
   */
  async getUnifiedInvoiceStream(params: {
    auth?: {
      tenantId?: string;
      businessId?: string;
      isAdmin?: boolean;
    };
    type?: string;
    status?: string;
    source?: string;
    erpInvoiceId?: string;
    paymentStatus?: string;
    irn?: string;
    search?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{
    items: any[];
    total: number;
    countsByType?: { outbound: number; inbound: number };
  }> {
    try {
      const page = Math.max(1, params.page || 1);
      const limit = Math.min(Math.max(1, params.limit || 20), 100);
      const offset = (page - 1) * limit;
      const requestedType = (params.type || "all").toLowerCase().trim();

      const auth = params.auth;
      const tenantId = auth?.tenantId;
      const businessId = auth?.businessId;
      const isAdmin = auth?.isAdmin;

      // 1. Build outbound match query
      const outboundMatch: any = {};
      if (!isAdmin && tenantId) outboundMatch.tenantId = tenantId;
      if (params.status?.trim()) {
        const statusVal = params.status.trim().toUpperCase();
        if (statusVal === "FAILED") {
          outboundMatch.status = { $in: ["FAILED", "TRANSMISTION_FAILED"] };
        } else {
          outboundMatch.status = statusVal;
        }
      }
      if (params.source?.trim()) outboundMatch.source = params.source.trim();
      if (params.erpInvoiceId?.trim())
        outboundMatch.erpInvoiceId = params.erpInvoiceId.trim();
      if (params.irn?.trim())
        outboundMatch.irn = safeSearchRegExp(params.irn.trim());
      if (params.search?.trim()) {
        const searchRegex = safeSearchRegExp(params.search.trim());
        outboundMatch.$or = [
          { invoiceNumber: searchRegex },
          { customerName: searchRegex },
          { customerTIN: searchRegex },
          { irn: searchRegex },
        ];
      }
      if (params.from || params.to) {
        outboundMatch.createdAt = {};
        if (params.from) outboundMatch.createdAt.$gte = params.from;
        if (params.to) outboundMatch.createdAt.$lte = params.to;
      }

      // 2. Build inbound match query
      const inboundMatch: any = {};
      if (businessId?.trim()) {
        inboundMatch.businessId = businessId.trim();
      } else if (!isAdmin && tenantId) {
        inboundMatch.tenantId = tenantId;
      }
      if (params.status?.trim()) {
        inboundMatch.status = params.status.trim().toUpperCase();
      }
      if (params.paymentStatus?.trim()) {
        inboundMatch["payment.paymentStatus"] = params.paymentStatus.trim();
      }
      if (params.irn?.trim())
        inboundMatch.irn = safeSearchRegExp(params.irn.trim());
      if (params.search?.trim()) {
        const searchRegex = safeSearchRegExp(params.search.trim());
        inboundMatch.$or = [
          { invoiceNumber: searchRegex },
          { supplierName: searchRegex },
          { supplierTIN: searchRegex },
          { irn: searchRegex },
        ];
      }
      if (params.from || params.to) {
        inboundMatch.createdAt = {};
        if (params.from) inboundMatch.createdAt.$gte = params.from;
        if (params.to) inboundMatch.createdAt.$lte = params.to;
      }

      const outboundProjectStage = {
        $project: {
          irn: { $ifNull: ["$irn", null] },
          erpInvoiceId: { $ifNull: ["$erpInvoiceId", null] },
          source: { $ifNull: ["$source", "api"] },
          type: { $literal: "outbound" },
          direction: { $literal: "OUTBOUND" },
          invoiceNumber: {
            $ifNull: [
              "$invoiceNumber",
              "$metadata.invoiceNumber",
              "$metadata.InvoiceNumber",
              "$metadata.invoice_number",
              null,
            ],
          },
          status: { $ifNull: ["$status", "CREATED"] },
          paymentStatus: {
            $ifNull: [
              "$paymentStatus",
              "$paymentDetails.paymentStatus",
              "PENDING",
            ],
          },
          qrCode: { $ifNull: ["$qrCode", null] },
          erp: { $ifNull: ["$erpSystem", null] },
          workflowState: { $ifNull: ["$workflowState", null] },
          lastJobError: { $ifNull: ["$lastJobError", null] },
          customerName: {
            $ifNull: [
              "$customerName",
              "$metadata.AccountingCustomerParty.Party.PartyName.0.Name",
              "$metadata.accounting_customer_party.party_name",
              "$metadata.customerName",
              null,
            ],
          },
          supplierName: {
            $ifNull: [
              "$supplierName",
              "$metadata.AccountingSupplierParty.Party.PartyName.0.Name",
              "$metadata.accounting_supplier_party.party_name",
              "$metadata.supplierName",
              null,
            ],
          },
          totalAmount: {
            $ifNull: [
              "$totalAmount",
              "$metadata.LegalMonetaryTotal.PayableAmount.value",
              "$metadata.legal_monetary_total.payable_amount",
              "$metadata.totalAmount",
              0,
            ],
          },
          currency: {
            $ifNull: [
              "$currency",
              "$metadata.DocumentCurrencyCode",
              "$metadata.document_currency_code",
              "NGN",
            ],
          },
          webhookEventCount: {
            $cond: {
              if: { $isArray: "$webhookEvents" },
              then: { $size: "$webhookEvents" },
              else: 0,
            },
          },
          createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
          updatedAt: { $ifNull: ["$updatedAt", "$$NOW"] },
        },
      };

      const inboundProjectStage = {
        $project: {
          irn: { $ifNull: ["$irn", null] },
          erpInvoiceId: { $literal: null },
          source: { $literal: "inbound" },
          type: { $literal: "inbound" },
          direction: { $literal: "INBOUND" },
          invoiceNumber: {
            $ifNull: ["$invoiceNumber", "$invoice.invoiceNumber", null],
          },
          status: { $ifNull: ["$status", "TRANSMITTED"] },
          paymentStatus: {
            $ifNull: ["$paymentStatus", "$payment.paymentStatus", "PENDING"],
          },
          qrCode: { $ifNull: ["$qrCode", null] },
          erp: { $literal: null },
          workflowState: { $ifNull: ["$workflowState", null] },
          lastJobError: { $literal: null },
          customerName: {
            $ifNull: [
              "$customerName",
              "$invoice.accounting_customer_party.party_name",
              "$invoice.customerName",
              null,
            ],
          },
          supplierName: {
            $ifNull: [
              "$supplierName",
              "$invoice.accounting_supplier_party.party_name",
              "$invoice.supplierName",
              null,
            ],
          },
          totalAmount: {
            $ifNull: [
              "$totalAmount",
              "$invoice.legal_monetary_total.payable_amount",
              "$invoice.totalAmount",
              0,
            ],
          },
          currency: {
            $ifNull: [
              "$currency",
              "$invoice.document_currency_code",
              "$invoice.currency",
              "NGN",
            ],
          },
          webhookEventCount: {
            $cond: {
              if: { $isArray: "$webhookEvents" },
              then: { $size: "$webhookEvents" },
              else: 0,
            },
          },
          createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
          updatedAt: { $ifNull: ["$updatedAt", "$$NOW"] },
        },
      };

      let aggregationResult: any;
      let outboundTotal = 0;
      let inboundTotal = 0;

      // Count operations to populate countsByType correctly
      const [outboundCount, inboundCount] = await Promise.all([
        this.outboundInvoiceModel.countDocuments(outboundMatch).exec(),
        this.inboundInvoiceModel.countDocuments(inboundMatch).exec(),
      ]);
      outboundTotal = outboundCount || 0;
      inboundTotal = inboundCount || 0;

      if (requestedType === "inbound") {
        const inboundPipeline: any[] = [
          { $match: inboundMatch },
          inboundProjectStage,
          { $sort: { updatedAt: -1 } },
          {
            $facet: {
              totalCount: [{ $count: "count" }],
              items: [{ $skip: offset }, { $limit: limit }],
            },
          },
        ];
        [aggregationResult] = await this.inboundInvoiceModel
          .aggregate(inboundPipeline)
          .option({ maxTimeMS: 25000 })
          .exec();
      } else if (requestedType === "outbound") {
        const outboundPipeline: any[] = [
          { $match: outboundMatch },
          outboundProjectStage,
          { $sort: { updatedAt: -1 } },
          {
            $facet: {
              totalCount: [{ $count: "count" }],
              items: [{ $skip: offset }, { $limit: limit }],
            },
          },
        ];
        [aggregationResult] = await this.outboundInvoiceModel
          .aggregate(outboundPipeline)
          .option({ maxTimeMS: 25000 })
          .exec();
      } else {
        const unifiedPipeline: any[] = [
          { $match: outboundMatch },
          outboundProjectStage,
          {
            $unionWith: {
              coll: "inbound_invoices",
              pipeline: [{ $match: inboundMatch }, inboundProjectStage],
            },
          },
          { $sort: { updatedAt: -1 } },
          {
            $facet: {
              totalCount: [{ $count: "count" }],
              items: [{ $skip: offset }, { $limit: limit }],
            },
          },
        ];
        [aggregationResult] = await this.outboundInvoiceModel
          .aggregate(unifiedPipeline)
          .option({ maxTimeMS: 25000 })
          .exec();
      }

      const total = requestedType === "outbound"
        ? outboundTotal
        : requestedType === "inbound"
          ? inboundTotal
          : outboundTotal + inboundTotal;

      const items = aggregationResult?.items || [];

      return {
        items,
        total,
        countsByType: {
          outbound: outboundTotal,
          inbound: inboundTotal,
        },
      };
    } catch (error) {
      console.error("Error executing unified invoice aggregation stream:", error);
      throw new AppError(500, "Failed to retrieve unified invoice stream");
    }
  }

  /**
   * Get invoice dashboard metrics (Total, Outbound, Inbound counts)
   */
  async getInvoiceMetrics(params: {
    auth?: {
      tenantId?: string;
      businessId?: string;
      isAdmin?: boolean;
    };
    from?: Date;
    to?: Date;
  }): Promise<{
    total: number;
    outbound: number;
    inbound: number;
  }> {
    try {
      const auth = params.auth;
      const tenantId = auth?.tenantId;
      const businessId = auth?.businessId;
      const isAdmin = auth?.isAdmin;

      const outboundMatch: any = {};
      if (!isAdmin && tenantId) outboundMatch.tenantId = tenantId;

      if (params.from || params.to) {
        outboundMatch.createdAt = {};
        if (params.from) outboundMatch.createdAt.$gte = params.from;
        if (params.to) outboundMatch.createdAt.$lte = params.to;
      }

      const inboundMatch: any = {};
      if (businessId?.trim()) inboundMatch.businessId = businessId.trim();
      else if (!isAdmin && tenantId) inboundMatch.tenantId = tenantId;

      if (params.from || params.to) {
        inboundMatch.createdAt = {};
        if (params.from) inboundMatch.createdAt.$gte = params.from;
        if (params.to) inboundMatch.createdAt.$lte = params.to;
      }

      const [outboundCount, inboundCount] = await Promise.all([
        this.outboundInvoiceModel
          .countDocuments(outboundMatch)
          .maxTimeMS(20000)
          .exec(),
        this.inboundInvoiceModel
          .countDocuments(inboundMatch)
          .maxTimeMS(20000)
          .exec(),
      ]);

      return {
        total: (outboundCount || 0) + (inboundCount || 0),
        outbound: outboundCount || 0,
        inbound: inboundCount || 0,
      };
    } catch (error) {
      console.error("Error computing invoice metrics:", error);
      throw new AppError(500, "Failed to compute invoice metrics");
    }
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
        .maxTimeMS(20000)
        .lean()
        .exec();

      return docs as unknown as OutboundInvoiceDocument[];
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
        throw new AppError(400, error);
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
        { upsert: true, returnDocument: "after", runValidators: true },
      );

      return doc!;
    } catch (error: any) {
      console.error("Error upserting outbound invoice:", error);
      if (error.name === "ValidationError") {
        throw new AppError(400, error);
      }
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

      const updateDoc: any = { $set: updateData };
      if (data.status === OutboundInvoiceStatus.DELIVERED) {
        updateDoc.$unset = { lastJobError: 1 };
      }

      const doc = await this.outboundInvoiceModel
        .findOneAndUpdate(query, updateDoc, {
          returnDocument: "after",
          runValidators: true,
        })
        .exec();

      if (!doc) {
        throw new AppError(404, "Outbound invoice not found");
      }

      return doc;
    } catch (error: any) {
      console.error("Error updating outbound invoice:", error);
      if (error.name === "ValidationError") {
        throw new AppError(400, error);
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
        .maxTimeMS(20000)
        .exec();
      return count;
    } catch (error) {
      console.error("Error counting outbound invoices:", error);
      return 0;
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
      console.log({ doc, irn });

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
      const updateDoc: any = { $set: { status } };
      if (
        status === OutboundInvoiceStatus.CREATED ||
        status === OutboundInvoiceStatus.DELIVERED
      ) {
        updateDoc.$unset = { lastJobError: 1 };
      }

      const doc = await this.outboundInvoiceModel
        .findOneAndUpdate({ irn }, updateDoc, { returnDocument: "after" })
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
        .findOneAndUpdate(
          { irn },
          { $set: updateFields },
          { returnDocument: "after" },
        )
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
          { returnDocument: "after" },
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
          { returnDocument: "after" },
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
        .findOneAndUpdate(
          { irn },
          { $set: update },
          { returnDocument: "after" },
        )
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
      let webhookEvents: any[] = [];
      if (eventIds.length > 0) {
        webhookEvents = await WebhookEventModel.find({
          eventId: { $in: eventIds },
        })
          .sort({ createdAt: 1 })
          .exec();
      }

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
