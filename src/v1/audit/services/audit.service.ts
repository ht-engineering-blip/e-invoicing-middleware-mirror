/**
 * Audit Service
 * Business logic for audit logging and reporting
 */

import { AuditLogRepository } from '../repos/audit-log.repo';
import { NotFoundError } from '../../../@lib/errors';
import type { AuditLogDocument } from '../models';
import { AuditEventType, AuditEventSeverity } from '../models';


export class AuditService {
  private auditRepo: AuditLogRepository;

  constructor() {
    this.auditRepo = new AuditLogRepository();
  }

  /**
   * Create audit log entry
   */
  async createAuditLog(input: CreateAuditLogInput): Promise<AuditLogDocument> {
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const auditLog = await this.auditRepo.create({
      eventId,
      tenantId: input.tenantId,
      eventType: input.eventType,
      severity: input.severity || AuditEventSeverity.INFO,
      actor: {
        actorType: input.actorType || 'user',
        actorId: input.actorId,
        actorName: input.actorName,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
      resource: {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        resourceName: input.resourceName,
      },
      description: input.description,
      metadata: input.metadata || {},
      timestamp: new Date(),
    });

    return auditLog;
  }

  /**
   * List audit logs with filters
   */
  async listAuditLogs(input: ListAuditLogsInput): Promise<{
    logs: AuditLogDocument[];
    total: number;
    skip: number;
    limit: number;
  }> {
    const query: any = {};

    if (input.tenantId) query.tenantId = input.tenantId;
    if (input.actorId) query['actor.actorId'] = input.actorId;
    if (input.eventType) query.eventType = input.eventType;
    if (input.resourceType) query['resource.resourceType'] = input.resourceType;
    if (input.resourceId) query['resource.resourceId'] = input.resourceId;

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
  async getAuditLog(eventId: string): Promise<AuditLogDocument> {
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
    resourceType: string,
    resourceId: string,
    tenantId?: string
  ): Promise<AuditLogDocument[]> {
    return this.auditRepo.findByResource(resourceType, resourceId);
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

    if (input.tenantId) query.tenantId = input.tenantId;
    if (input.eventTypes && input.eventTypes.length > 0) {
      query.eventType = { $in: input.eventTypes };
    }
    if (input.resourceTypes && input.resourceTypes.length > 0) {
      query['resource.resourceType'] = { $in: input.resourceTypes };
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
        tenantId: input.tenantId,
        eventTypes: input.eventTypes,
        resourceTypes: input.resourceTypes,
      },
      totalRecords: logs.length,
      logs,
    };
  }

  /**
   * Get audit statistics
   */
  async getStatistics(input: AuditStatisticsInput): Promise<any> {
    const groupBy = input.groupBy || 'eventType';

    const statistics = await this.auditRepo.getStatistics(
      input.startDate,
      input.endDate,
      input.tenantId,
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
   * Get activity summary for tenant
   */
  async getActivitySummary(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    const query = {
      tenantId,
      timestamp: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    const logs = await this.auditRepo.find(query, 0, 100000);

    // Aggregate statistics
    const eventTypeCounts: Record<string, number> = {};
    const resourceTypeCounts: Record<string, number> = {};
    const actorActivity: Record<string, number> = {};
    const dailyActivity: Record<string, number> = {};

    for (const log of logs) {
      // Count by event type
      eventTypeCounts[log.eventType] = (eventTypeCounts[log.eventType] || 0) + 1;

      // Count by resource type
      const resourceType = typeof log.resource === 'object' ? log.resource.resourceType : log.resource;
      resourceTypeCounts[resourceType] = (resourceTypeCounts[resourceType] || 0) + 1;

      // Count by actor
      const actorId = log.actor?.actorId || 'unknown';
      actorActivity[actorId] = (actorActivity[actorId] || 0) + 1;

      // Count by day
      const day = log.timestamp.toISOString().split('T')[0];
      dailyActivity[day] = (dailyActivity[day] || 0) + 1;
    }

    return {
      period: { startDate, endDate },
      totalEvents: logs.length,
      eventTypeBreakdown: eventTypeCounts,
      resourceTypeBreakdown: resourceTypeCounts,
      actorActivity,
      dailyActivity,
      topEventTypes: this.getTopN(eventTypeCounts, 10),
      topResourceTypes: this.getTopN(resourceTypeCounts, 10),
      topActors: this.getTopN(actorActivity, 10),
    };
  }

  /**
   * Get compliance report
   * Returns audit logs relevant for compliance (7-year retention)
   */
  async getComplianceReport(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    const criticalEventTypes = [
      AuditEventType.INVOICE_SUBMITTED,
      AuditEventType.INVOICE_VALIDATED,
      AuditEventType.INVOICE_SIGNED,
      AuditEventType.INVOICE_TRANSMITTED,
      AuditEventType.INVOICE_RECEIVED,
      AuditEventType.INVOICE_ACKNOWLEDGED,
      AuditEventType.TENANT_CREATED,
      AuditEventType.TENANT_ACTIVATED,
      AuditEventType.TENANT_SUSPENDED,
      AuditEventType.TENANT_DELETED,
      AuditEventType.API_KEY_CREATED,
      AuditEventType.API_KEY_REVOKED,
    ];

    const query = {
      tenantId,
      eventType: { $in: criticalEventTypes },
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
      tenantId,
      totalRecords: logs.length,
      criticalEventTypes,
      logs: logs.map((log) => ({
        timestamp: log.timestamp,
        eventType: log.eventType,
        severity: log.severity,
        resource: log.resource,
        actor: log.actor,
        description: log.description,
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
      tenantId?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    }
  ): Promise<AuditLogDocument[]> {
    const query: any = {};

    if (filters?.tenantId) query.tenantId = filters.tenantId;
    if (filters?.startDate || filters?.endDate) {
      query.timestamp = {};
      if (filters.startDate) query.timestamp.$gte = filters.startDate;
      if (filters.endDate) query.timestamp.$lte = filters.endDate;
    }

    // Add text search
    query.$or = [
      { eventType: { $regex: searchTerm, $options: 'i' } },
      { 'resource.resourceType': { $regex: searchTerm, $options: 'i' } },
      { 'resource.resourceId': { $regex: searchTerm, $options: 'i' } },
      { 'actor.actorId': { $regex: searchTerm, $options: 'i' } },
      { description: { $regex: searchTerm, $options: 'i' } },
    ];

    const limit = filters?.limit || 100;
    return this.auditRepo.find(query, 0, limit);
  }

  /**
   * Private: Generate CSV report
   */
  private generateCSVReport(logs: AuditLogDocument[]): string {
    const headers = [
      'Timestamp',
      'Tenant ID',
      'Event Type',
      'Severity',
      'Actor ID',
      'Actor Type',
      'Resource Type',
      'Resource ID',
      'Description',
      'IP Address',
      'Metadata',
    ];

    const rows = logs.map((log) => [
      log.timestamp.toISOString(),
      log.tenantId || '',
      log.eventType,
      log.severity,
      log.actor?.actorId || '',
      log.actor?.actorType || '',
      typeof log.resource === 'object' ? log.resource.resourceType : '',
      typeof log.resource === 'object' ? log.resource.resourceId : '',
      log.description || '',
      log.actor?.ipAddress || '',
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
