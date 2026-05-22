import { AppError } from '../../../@lib';
import { ModelWrapper } from '../../../@lib/adapters/mongo/model-wrapper';
import {
  AuditLogDocument,
  AuditLogModel,
  AuditEventType,
  AuditEventSeverity,
} from '../models/audit-log.model';

export class AuditLogRepository {
  private auditLogModel: ModelWrapper<AuditLogDocument>;

  constructor() {
    this.auditLogModel = new ModelWrapper<AuditLogDocument>(AuditLogModel);
  }

  /**
   * Build MongoDB query from where conditions
   */
  private buildAuditLogQuery(where?: any): any {
    if (!where) return {};

    const query: any = {};

    // Simple equality checks
    if (where.id?._eq) query._id = where.id._eq;
    if (where.tenantId?._eq) query.tenantId = where.tenantId._eq;
    if (where.businessId?._eq) query.businessId = where.businessId._eq;
    if (where.eventId?._eq) query.eventId = where.eventId._eq;
    if (where.eventType?._eq) query.eventType = where.eventType._eq;
    if (where.severity?._eq) query.severity = where.severity._eq;
    if (where.actorId?._eq) query['actor.actorId'] = where.actorId._eq;
    if (where.actorType?._eq) query['actor.actorType'] = where.actorType._eq;
    if (where.resourceId?._eq) query['resource.resourceId'] = where.resourceId._eq;
    if (where.resourceType?._eq) query['resource.resourceType'] = where.resourceType._eq;

    // IN conditions
    if (where.eventType?._in) query.eventType = { $in: where.eventType._in };
    if (where.severity?._in) query.severity = { $in: where.severity._in };

    // Date range
    if (where.timestamp?._gte) query.timestamp = { ...query.timestamp, $gte: where.timestamp._gte };
    if (where.timestamp?._lte) query.timestamp = { ...query.timestamp, $lte: where.timestamp._lte };

    // AND conditions
    if (where._and && where._and.length > 0) {
      query.$and = where._and.map((andCondition: any) => {
        return this.buildAuditLogQuery(andCondition);
      });
    }

    return query;
  }

  /**
   * Build select projection
   */
  private buildAuditLogProjection(select?: any): any {
    return select && Object.keys(select).length > 0 ? select : null;
  }

  /**
   * Find many audit logs
   */
  async findMany(
    where?: any,
    select?: any,
    limit: number = 20,
    offset: number = 0
  ): Promise<AuditLogDocument[]> {
    try {
      const query = this.buildAuditLogQuery(where);
      const projection = this.buildAuditLogProjection(select);

      const docs = await this.auditLogModel
        .find(query, projection)
        .sort({ timestamp: -1 })
        .limit(limit)
        .skip(offset)
        .exec();

      return docs;
    } catch (error) {
      console.error('Error finding audit logs:', error);
      throw new AppError(500, 'Failed to fetch audit logs');
    }
  }

  /**
   * Find one audit log
   */
  async findOne(where: any, select?: any): Promise<AuditLogDocument | null> {
    try {
      const query = this.buildAuditLogQuery(where);
      const projection = this.buildAuditLogProjection(select);

      const doc = await this.auditLogModel.findOne(query, projection).exec();

      return doc;
    } catch (error) {
      console.error('Error finding audit log:', error);
      throw new AppError(500, 'Failed to fetch audit log');
    }
  }

  /**
   * Create a new audit log
   */
  async create(data: Partial<AuditLogDocument>): Promise<AuditLogDocument> {
    try {
      const doc = await this.auditLogModel.create({
        ...data,
        timestamp: data.timestamp || new Date(),
      });

      return doc;
    } catch (error: any) {
      console.error('Error creating audit log:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error.code === 11000) {
        throw new AppError(409, 'Audit log with this eventId already exists');
      }
      throw new AppError(500, 'Failed to create audit log');
    }
  }

  /**
   * Count audit logs
   */
  async count(where?: any): Promise<number> {
    try {
      const query = this.buildAuditLogQuery(where);
      const count = await this.auditLogModel.countDocuments(query).exec();
      return count;
    } catch (error) {
      console.error('Error counting audit logs:', error);
      throw new AppError(500, 'Failed to count audit logs');
    }
  }

  /**
   * Find audit logs by tenant ID
   */
  async findByTenantId(
    tenantId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: AuditLogDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { tenantId };

      const [docs, total] = await Promise.all([
        this.auditLogModel
          .find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.auditLogModel.countDocuments(query).exec(),
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
      console.error('Error fetching audit logs:', error);
      throw new AppError(500, 'Failed to fetch audit logs');
    }
  }

  /**
   * Find audit log by event ID
   */
  async findByEventId(eventId: string): Promise<AuditLogDocument | null> {
    try {
      const doc = await this.auditLogModel.findOne({ eventId }).exec();
      return doc;
    } catch (error) {
      console.error('Error fetching audit log:', error);
      throw new AppError(500, 'Failed to fetch audit log');
    }
  }

  /**
   * Find audit log by ID (alias for findByEventId)
   */
  async findById(id: string): Promise<AuditLogDocument | null> {
    return this.findByEventId(id);
  }

  /**
   * Generic find with query object (for service layer compatibility)
   */
  async find(query: any, skip: number = 0, limit: number = 50): Promise<AuditLogDocument[]> {
    try {
      const docs = await this.auditLogModel
        .find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .exec();
      return docs;
    } catch (error) {
      console.error('Error finding audit logs:', error);
      throw new AppError(500, 'Failed to fetch audit logs');
    }
  }

  /**
   * Find audit logs by resource type and resource ID
   */
  async findByResource(resource: string, resourceId: string): Promise<AuditLogDocument[]> {
    try {
      const docs = await this.auditLogModel
        .find({
          'resource.resourceType': resource,
          'resource.resourceId': resourceId,
        })
        .sort({ timestamp: -1 })
        .exec();
      return docs;
    } catch (error) {
      console.error('Error fetching audit logs by resource:', error);
      throw new AppError(500, 'Failed to fetch audit logs');
    }
  }

  /**
   * Find audit logs by resource ID
   */
  async findByResourceId(
    resourceId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: AuditLogDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { 'resource.resourceId': resourceId };

      const [docs, total] = await Promise.all([
        this.auditLogModel
          .find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.auditLogModel.countDocuments(query).exec(),
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
      console.error('Error fetching audit logs:', error);
      throw new AppError(500, 'Failed to fetch audit logs');
    }
  }

  /**
   * Find audit logs by event type
   */
  async findByEventType(
    eventType: AuditEventType,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: AuditLogDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { eventType };

      const [docs, total] = await Promise.all([
        this.auditLogModel
          .find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.auditLogModel.countDocuments(query).exec(),
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
      console.error('Error fetching audit logs by event type:', error);
      throw new AppError(500, 'Failed to fetch audit logs');
    }
  }

  /**
   * Find audit logs by severity
   */
  async findBySeverity(
    severity: AuditEventSeverity,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: AuditLogDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { severity };

      const [docs, total] = await Promise.all([
        this.auditLogModel
          .find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.auditLogModel.countDocuments(query).exec(),
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
      console.error('Error fetching audit logs by severity:', error);
      throw new AppError(500, 'Failed to fetch audit logs');
    }
  }

  /**
   * Find audit logs by actor
   */
  async findByActor(
    actorId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: AuditLogDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { 'actor.actorId': actorId };

      const [docs, total] = await Promise.all([
        this.auditLogModel
          .find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.auditLogModel.countDocuments(query).exec(),
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
      console.error('Error fetching audit logs by actor:', error);
      throw new AppError(500, 'Failed to fetch audit logs');
    }
  }

  /**
   * Find audit logs by date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    tenantId?: string,
    limit: number = 100,
    page: number = 1
  ): Promise<{ data: AuditLogDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = {
        timestamp: {
          $gte: startDate,
          $lte: endDate,
        },
      };

      if (tenantId) {
        query.tenantId = tenantId;
      }

      const [docs, total] = await Promise.all([
        this.auditLogModel
          .find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.auditLogModel.countDocuments(query).exec(),
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
      console.error('Error fetching audit logs by date range:', error);
      throw new AppError(500, 'Failed to fetch audit logs');
    }
  }

  /**
   * Get audit statistics
   */
  async getStatistics(
    startDate: Date,
    endDate: Date,
    tenantId?: string,
    groupBy: 'eventType' | 'severity' | 'actorType' | 'day' | 'hour' = 'eventType'
  ): Promise<any[]> {
    try {
      const matchStage: any = {
        timestamp: {
          $gte: startDate,
          $lte: endDate,
        },
      };

      if (tenantId) {
        matchStage.tenantId = tenantId;
      }

      let groupByField: any;
      switch (groupBy) {
        case 'eventType':
          groupByField = '$eventType';
          break;
        case 'severity':
          groupByField = '$severity';
          break;
        case 'actorType':
          groupByField = '$actor.actorType';
          break;
        case 'day':
          groupByField = { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } };
          break;
        case 'hour':
          groupByField = { $dateToString: { format: '%Y-%m-%d %H:00', date: '$timestamp' } };
          break;
        default:
          groupByField = '$eventType';
      }

      const stats = await this.auditLogModel
        .aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: groupByField,
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ])
        .exec();

      return stats;
    } catch (error) {
      console.error('Error getting audit statistics:', error);
      throw new AppError(500, 'Failed to get audit statistics');
    }
  }

  /**
   * Get error logs (severity: error or critical)
   */
  async findErrors(
    tenantId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: AuditLogDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = {
        tenantId,
        severity: { $in: [AuditEventSeverity.ERROR, AuditEventSeverity.CRITICAL] },
      };

      const [docs, total] = await Promise.all([
        this.auditLogModel
          .find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.auditLogModel.countDocuments(query).exec(),
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
      console.error('Error fetching error logs:', error);
      throw new AppError(500, 'Failed to fetch error logs');
    }
  }

  /**
   * Bulk create audit logs
   */
  async bulkCreate(logs: Array<Partial<AuditLogDocument>>): Promise<boolean> {
    try {
      await this.auditLogModel.create(logs);
      return true;
    } catch (error) {
      console.error('Error bulk creating audit logs:', error);
      throw new AppError(500, 'Failed to bulk create audit logs');
    }
  }

  /**
   * Delete old audit logs (for cleanup, respects TTL)
   */
  async deleteOldLogs(beforeDate: Date): Promise<number> {
    try {
      const result = await this.auditLogModel
        .deleteMany({
          timestamp: { $lt: beforeDate },
        })
        .exec();

      return result.deletedCount || 0;
    } catch (error) {
      console.error('Error deleting old audit logs:', error);
      throw new AppError(500, 'Failed to delete old audit logs');
    }
  }
}
