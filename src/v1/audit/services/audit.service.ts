/**
 * Audit Service
 * Business logic for audit logging and reporting
 */

import { AuditLogRepository } from '../repos/audit-log.repo';
import { AppError, NotFoundError } from '../../../@lib/errors';
import type { IAuditLog } from '../models';

export interface CreateAuditLogInput {
  businessId: string;
  tenantId: string;
  action: string;
  resource: string;
  resourceId: string;
  userId: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
}

export interface ListAuditLogsInput {
  businessId?: string;
  tenantId?: string;
  userId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  limit?: number;
}

export interface GenerateReportInput {
  businessId?: string;
  tenantId?: string;
  startDate: Date;
  endDate: Date;
  actions?: string[];
  resources?: string[];
  format?: 'json' | 'csv';
}

export interface AuditStatisticsInput {
  businessId?: string;
  tenantId?: string;
  startDate: Date;
  endDate: Date;
  groupBy?: 'action' | 'resource' | 'user' | 'day';
}

export class AuditService {
  private auditRepo: AuditLogRepository;

  constructor() {
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Create audit log entry
   */
  async createAuditLog(input: CreateAuditLogInput): Promise<IAuditLog> {
    const auditLog = await this.auditRepo.create({
      businessId: input.businessId,
      tenantId: input.tenantId,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      userId: input.userId,
      metadata: input.metadata,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return auditLog;
  }

  /**
   * List audit logs with filters
   */
  async listAuditLogs(input: ListAuditLogsInput): Promise<{
    logs: IAuditLog[];
    total: number;
    skip: number;
    limit: number;
  }> {
    const query: any = {};

    if (input.businessId) query.businessId = input.businessId;
    if (input.tenantId) query.tenantId = input.tenantId;
    if (input.userId) query.userId = input.userId;
    if (input.action) query.action = input.action;
    if (input.resource) query.resource = input.resource;
    if (input.resourceId) query.resourceId = input.resourceId;

    if (input.startDate || input.endDate) {
      query.timestamp = {};
      if (input.startDate) query.timestamp.$gte = input.startDate;
      if (input.endDate) query.timestamp.$lte = input.endDate;
    }

    const skip = input.skip || 0;
    const limit = input.limit || 50;

    const logs = await this.auditRepo.find(query, skip, limit);
    const total = await this.auditRepo.count(query);

    return {
      logs,
      total,
      skip,
      limit,
    };
  }

  /**
   * Get audit log by ID
   */
  async getAuditLog(eventId: string): Promise<IAuditLog> {
    const log = await this.auditRepo.findById(eventId);
    if (!log) {
      throw new NotFoundError('Audit log not found');
    }

    return log;
  }

  /**
   * Get audit trail for a resource
   */
  async getResourceAuditTrail(
    resource: string,
    resourceId: string,
    businessId?: string
  ): Promise<IAuditLog[]> {
    const query: any = {
      resource,
      resourceId,
    };

    if (businessId) query.businessId = businessId;

    return this.auditRepo.findByResource(resource, resourceId);
  }

  /**
   * Generate audit report
   */
  async generateReport(input: GenerateReportInput): Promise<any> {
    const query: any = {
      timestamp: {
        $gte: input.startDate,
        $lte: input.endDate,
      },
    };

    if (input.businessId) query.businessId = input.businessId;
    if (input.tenantId) query.tenantId = input.tenantId;
    if (input.actions && input.actions.length > 0) {
      query.action = { $in: input.actions };
    }
    if (input.resources && input.resources.length > 0) {
      query.resource = { $in: input.resources };
    }

    // Get all logs matching criteria
    const logs = await this.auditRepo.find(query, 0, 10000);

    if (input.format === 'csv') {
      return this.generateCSVReport(logs);
    }

    return {
      reportType: 'audit_log',
      generatedAt: new Date(),
      period: {
        startDate: input.startDate,
        endDate: input.endDate,
      },
      filters: {
        businessId: input.businessId,
        tenantId: input.tenantId,
        actions: input.actions,
        resources: input.resources,
      },
      totalRecords: logs.length,
      logs,
    };
  }

  /**
   * Get audit statistics
   */
  async getStatistics(input: AuditStatisticsInput): Promise<any> {
    const groupBy = input.groupBy || 'action';

    const statistics = await this.auditRepo.getStatistics(
      {
        businessId: input.businessId,
        tenantId: input.tenantId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      groupBy
    );

    return {
      period: {
        startDate: input.startDate,
        endDate: input.endDate,
      },
      groupBy,
      statistics,
    };
  }

  /**
   * Export audit logs
   */
  async exportLogs(input: ListAuditLogsInput & { format: 'json' | 'csv' }): Promise<any> {
    const result = await this.listAuditLogs(input);

    if (input.format === 'csv') {
      return this.generateCSVReport(result.logs);
    }

    return result;
  }

  /**
   * Get activity summary for business
   */
  async getActivitySummary(
    businessId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    const query = {
      businessId,
      timestamp: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    const logs = await this.auditRepo.find(query, 0, 100000);

    // Aggregate statistics
    const actionCounts: Record<string, number> = {};
    const resourceCounts: Record<string, number> = {};
    const userActivity: Record<string, number> = {};
    const dailyActivity: Record<string, number> = {};

    for (const log of logs) {
      // Count by action
      actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;

      // Count by resource
      resourceCounts[log.resource] = (resourceCounts[log.resource] || 0) + 1;

      // Count by user
      userActivity[log.userId] = (userActivity[log.userId] || 0) + 1;

      // Count by day
      const day = log.timestamp.toISOString().split('T')[0];
      dailyActivity[day] = (dailyActivity[day] || 0) + 1;
    }

    return {
      period: { startDate, endDate },
      totalEvents: logs.length,
      actionBreakdown: actionCounts,
      resourceBreakdown: resourceCounts,
      userActivity,
      dailyActivity,
      topActions: this.getTopN(actionCounts, 10),
      topResources: this.getTopN(resourceCounts, 10),
      topUsers: this.getTopN(userActivity, 10),
    };
  }

  /**
   * Get compliance report
   * Returns audit logs relevant for compliance (7-year retention)
   */
  async getComplianceReport(
    businessId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    const criticalActions = [
      'invoice.submitted',
      'invoice.validated',
      'invoice.signed',
      'invoice.transmitted',
      'invoice.received',
      'invoice.acknowledged',
      'tenant.created',
      'tenant.activated',
      'tenant.suspended',
      'tenant.deleted',
      'api_key.created',
      'api_key.revoked',
    ];

    const query = {
      businessId,
      action: { $in: criticalActions },
      timestamp: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    const logs = await this.auditRepo.find(query, 0, 100000);

    return {
      reportType: 'compliance',
      generatedAt: new Date(),
      period: { startDate, endDate },
      businessId,
      totalRecords: logs.length,
      criticalActions,
      logs: logs.map((log) => ({
        timestamp: log.timestamp,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        userId: log.userId,
        metadata: log.metadata,
      })),
    };
  }

  /**
   * Search audit logs by text
   */
  async searchLogs(
    searchTerm: string,
    filters?: {
      businessId?: string;
      tenantId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    }
  ): Promise<IAuditLog[]> {
    const query: any = {};

    if (filters?.businessId) query.businessId = filters.businessId;
    if (filters?.tenantId) query.tenantId = filters.tenantId;
    if (filters?.startDate || filters?.endDate) {
      query.timestamp = {};
      if (filters.startDate) query.timestamp.$gte = filters.startDate;
      if (filters.endDate) query.timestamp.$lte = filters.endDate;
    }

    // Add text search (this would work better with MongoDB text index)
    query.$or = [
      { action: { $regex: searchTerm, $options: 'i' } },
      { resource: { $regex: searchTerm, $options: 'i' } },
      { resourceId: { $regex: searchTerm, $options: 'i' } },
      { userId: { $regex: searchTerm, $options: 'i' } },
    ];

    const limit = filters?.limit || 100;
    return this.auditRepo.find(query, 0, limit);
  }

  /**
   * Private: Generate CSV report
   */
  private generateCSVReport(logs: IAuditLog[]): string {
    const headers = [
      'Timestamp',
      'Business ID',
      'Tenant ID',
      'Action',
      'Resource',
      'Resource ID',
      'User ID',
      'IP Address',
      'Metadata',
    ];

    const rows = logs.map((log) => [
      log.timestamp.toISOString(),
      log.businessId,
      log.tenantId,
      log.action,
      log.resource,
      log.resourceId,
      log.userId,
      log.ipAddress || '',
      JSON.stringify(log.metadata || {}),
    ]);

    const csvContent = [headers, ...rows].map((row) => row.join(',')).join('\n');

    return csvContent;
  }

  /**
   * Private: Get top N items from object
   */
  private getTopN(obj: Record<string, number>, n: number): Array<{ key: string; count: number }> {
    return Object.entries(obj)
      .sort(([, a], [, b]) => b - a)
      .slice(0, n)
      .map(([key, count]) => ({ key, count }));
  }

  /**
   * Clean up old audit logs (beyond retention period)
   * Note: MongoDB TTL index should handle this automatically
   */
  async cleanupOldLogs(retentionDays: number = 2555): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const query = {
      timestamp: { $lt: cutoffDate },
    };

    const count = await this.auditRepo.count(query);
    // Note: Actual deletion should be handled by MongoDB TTL index
    // This method is for manual cleanup if needed

    return count;
  }
}
