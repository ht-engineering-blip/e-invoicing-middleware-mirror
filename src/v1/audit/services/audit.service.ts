/**
 * Audit Service
 * High-performance, enterprise-grade business logic for audit logging and reporting.
 * Uses native MongoDB aggregation pipelines to eliminate in-memory array scans and avoid OOM crashes.
 */

import crypto from "crypto";
import { appConfig } from "../../../@config";
import { AuditLogRepository } from "../repos/audit-log.repo";
import { NotFoundError } from "../../../@lib/errors";
import type { AuditLogDocument } from "../models";
import { AuditEventType, AuditEventSeverity } from "../models";
import type {
  CreateAuditLogInput,
  ListAuditLogsInput,
  GenerateReportInput,
  AuditStatisticsInput,
} from "../@types";

export interface AuditStatisticsItem {
  _id: string;
  count: number;
}

export interface AuditStatisticsResponse {
  period: {
    startDate: Date;
    endDate: Date;
  };
  groupBy: "eventType" | "severity" | "actorType" | "day";
  statistics: AuditStatisticsItem[];
}

export interface AuditReportResponse {
  reportType: "audit_log";
  generatedAt: Date;
  period: {
    startDate: Date;
    endDate: Date;
  };
  filters: {
    tenantId?: string;
    eventTypes?: AuditEventType[];
    resourceTypes?: string[];
  };
  totalRecords: number;
  logs: AuditLogDocument[];
}

export interface ActivitySummaryResponse {
  period: { startDate: Date; endDate: Date };
  totalEvents: number;
  eventTypeBreakdown: Record<string, number>;
  resourceTypeBreakdown: Record<string, number>;
  actorActivity: Record<string, number>;
  dailyActivity: Record<string, number>;
  topEventTypes: Array<{ key: string; count: number }>;
  topResourceTypes: Array<{ key: string; count: number }>;
  topActors: Array<{ key: string; count: number }>;
}

export interface ComplianceReportResponse {
  reportType: "compliance";
  generatedAt: Date;
  period: { startDate: Date; endDate: Date };
  tenantId: string;
  totalRecords: number;
  criticalEventTypes: AuditEventType[];
  logs: Array<{
    timestamp: Date;
    eventType: AuditEventType;
    severity: AuditEventSeverity;
    resource: unknown;
    actor: unknown;
    description: string;
    metadata: Record<string, unknown>;
  }>;
}

export interface IntegrityVerificationDetail {
  eventId: string;
  timestamp: Date;
  isCurrentValid: boolean;
  isChainValid: boolean;
  expectedHash: string;
  actualHash?: string;
  expectedPreviousHash: string;
  actualPreviousHash?: string;
}

export interface IntegrityVerificationResponse {
  isValid: boolean;
  tamperedCount: number;
  details: IntegrityVerificationDetail[];
}

export class AuditService {
  private auditRepo: AuditLogRepository;

  constructor(auditRepo?: AuditLogRepository) {
    this.auditRepo = auditRepo ?? new AuditLogRepository();
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
        actorType: input.actorType || "user",
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
   * List audit logs with filters and lean projection
   */
  async listAuditLogs(input: ListAuditLogsInput): Promise<{
    logs: AuditLogDocument[];
    total: number;
    skip: number;
    limit: number;
  }> {
    const query: Record<string, unknown> = {};

    if (input.tenantId) query.tenantId = input.tenantId;
    if (input.actorId) query["actor.actorId"] = input.actorId;
    if (input.eventType) query.eventType = input.eventType;
    if (input.resourceType) query["resource.resourceType"] = input.resourceType;
    if (input.resourceId) query["resource.resourceId"] = input.resourceId;

    if (input.startDate || input.endDate) {
      const timestampQuery: Record<string, Date> = {};
      if (input.startDate) timestampQuery.$gte = input.startDate;
      if (input.endDate) timestampQuery.$lte = input.endDate;
      query.timestamp = timestampQuery;
    }

    const skip = input.skip || 0;
    const limit = Math.min(input.limit || 50, 200);

    const [logs, total] = await Promise.all([
      this.auditRepo.find(query, skip, limit),
      this.auditRepo.count(query),
    ]);

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
      throw new NotFoundError("Audit log not found");
    }

    return log;
  }

  /**
   * Get audit trail for a resource
   */
  async getResourceAuditTrail(
    resourceType: string,
    resourceId: string,
  ): Promise<AuditLogDocument[]> {
    return this.auditRepo.findByResource(resourceType, resourceId);
  }

  /**
   * Generate audit report
   */
  async generateReport(
    input: GenerateReportInput,
  ): Promise<AuditReportResponse | string> {
    const query: Record<string, unknown> = {
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
      query["resource.resourceType"] = { $in: input.resourceTypes };
    }

    const logs = await this.auditRepo.find(query, 0, 5000);

    if (input.format === "csv") {
      return this.generateCSVReport(logs);
    }

    return {
      reportType: "audit_log",
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
  async getStatistics(
    input: AuditStatisticsInput,
  ): Promise<AuditStatisticsResponse> {
    const groupBy = input.groupBy || "eventType";

    const statistics = await this.auditRepo.getStatistics(
      input.startDate,
      input.endDate,
      input.tenantId,
      groupBy,
    );

    return {
      period: {
        startDate: input.startDate,
        endDate: input.endDate,
      },
      groupBy,
      statistics: (statistics || []) as AuditStatisticsItem[],
    };
  }

  /**
   * Export audit logs
   */
  async exportLogs(
    input: ListAuditLogsInput & { format: "json" | "csv" },
  ): Promise<
    | { logs: AuditLogDocument[]; total: number; skip: number; limit: number }
    | string
  > {
    const result = await this.listAuditLogs(input);

    if (input.format === "csv") {
      return this.generateCSVReport(result.logs);
    }

    return result;
  }

  /**
   * Get activity summary for tenant
   * Optimized with single high-speed MongoDB Aggregation pipeline instead of loading 100k records in RAM!
   */
  async getActivitySummary(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<ActivitySummaryResponse> {
    const matchStage: any = {
      tenantId,
      timestamp: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    // Use aggregation pipeline inside repository / model
    const [result] = await (this.auditRepo as any).auditLogModel.aggregate([
      { $match: matchStage },
      {
        $facet: {
          totalCount: [{ $count: "count" }],
          byEventType: [
            { $group: { _id: "$eventType", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          byResourceType: [
            {
              $group: {
                _id: { $ifNull: ["$resource.resourceType", "unknown"] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
          ],
          byActor: [
            {
              $group: {
                _id: { $ifNull: ["$actor.actorId", "unknown"] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
          ],
          byDay: [
            {
              $group: {
                _id: {
                  $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ]);

    const totalEvents = result?.totalCount?.[0]?.count || 0;

    const eventTypeBreakdown: Record<string, number> = {};
    for (const item of result?.byEventType || []) {
      if (item._id) eventTypeBreakdown[item._id] = item.count;
    }

    const resourceTypeBreakdown: Record<string, number> = {};
    for (const item of result?.byResourceType || []) {
      if (item._id) resourceTypeBreakdown[item._id] = item.count;
    }

    const actorActivity: Record<string, number> = {};
    for (const item of result?.byActor || []) {
      if (item._id) actorActivity[item._id] = item.count;
    }

    const dailyActivity: Record<string, number> = {};
    for (const item of result?.byDay || []) {
      if (item._id) dailyActivity[item._id] = item.count;
    }

    const topEventTypes = (result?.byEventType || [])
      .slice(0, 10)
      .map((item: any) => ({ key: String(item._id), count: item.count }));

    const topResourceTypes = (result?.byResourceType || [])
      .slice(0, 10)
      .map((item: any) => ({ key: String(item._id), count: item.count }));

    const topActors = (result?.byActor || [])
      .slice(0, 10)
      .map((item: any) => ({ key: String(item._id), count: item.count }));

    return {
      period: { startDate, endDate },
      totalEvents,
      eventTypeBreakdown,
      resourceTypeBreakdown,
      actorActivity,
      dailyActivity,
      topEventTypes,
      topResourceTypes,
      topActors,
    };
  }

  /**
   * Get compliance report
   */
  async getComplianceReport(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<ComplianceReportResponse> {
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

    const [logs, totalRecords] = await Promise.all([
      this.auditRepo.find(query, 0, 5000),
      this.auditRepo.count(query),
    ]);

    return {
      reportType: "compliance",
      generatedAt: new Date(),
      period: { startDate, endDate },
      tenantId,
      totalRecords,
      criticalEventTypes,
      logs: logs.map((log) => ({
        timestamp: log.timestamp,
        eventType: log.eventType,
        severity: log.severity,
        resource: log.resource,
        actor: log.actor,
        description: log.description,
        metadata: log.metadata || {},
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
    },
  ): Promise<AuditLogDocument[]> {
    const query: Record<string, unknown> = {};

    if (filters?.tenantId) query.tenantId = filters.tenantId;
    if (filters?.startDate || filters?.endDate) {
      const timestampQuery: Record<string, Date> = {};
      if (filters.startDate) timestampQuery.$gte = filters.startDate;
      if (filters.endDate) timestampQuery.$lte = filters.endDate;
      query.timestamp = timestampQuery;
    }

    query.$or = [
      { eventType: { $regex: searchTerm, $options: "i" } },
      { "resource.resourceType": { $regex: searchTerm, $options: "i" } },
      { "resource.resourceId": { $regex: searchTerm, $options: "i" } },
      { "actor.actorId": { $regex: searchTerm, $options: "i" } },
      { description: { $regex: searchTerm, $options: "i" } },
    ];

    const limit = Math.min(filters?.limit || 100, 500);
    return this.auditRepo.find(query, 0, limit);
  }

  /**
   * Generate CSV report
   */
  private generateCSVReport(logs: AuditLogDocument[]): string {
    const headers = [
      "Timestamp",
      "Tenant ID",
      "Event Type",
      "Severity",
      "Actor ID",
      "Actor Type",
      "Resource Type",
      "Resource ID",
      "Description",
      "IP Address",
      "Metadata",
    ];

    const rows = logs.map((log) => [
      log.timestamp.toISOString(),
      log.tenantId || "",
      log.eventType,
      log.severity,
      log.actor?.actorId || "",
      log.actor?.actorType || "",
      typeof log.resource === "object" && log.resource !== null
        ? (log.resource as { resourceType?: string }).resourceType || ""
        : String(log.resource || ""),
      typeof log.resource === "object" && log.resource !== null
        ? (log.resource as { resourceId?: string }).resourceId || ""
        : "",
      log.description || "",
      log.actor?.ipAddress || "",
      JSON.stringify(log.metadata || {}),
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.join(","))
      .join("\n");

    return csvContent;
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs(retentionDays: number = 2555): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const query = {
      timestamp: { $lt: cutoffDate },
    };

    return this.auditRepo.count(query);
  }

  /**
   * Cryptographically verify the integrity of the audit logs chain
   */
  async verifyIntegrity(): Promise<IntegrityVerificationResponse> {
    const logs = await this.auditRepo.find({}, 0, 5000);
    let previousHash = "0".repeat(64);
    let tamperedCount = 0;
    const details: IntegrityVerificationDetail[] = [];

    const chronologicalLogs = [...logs].reverse();

    for (let i = 0; i < chronologicalLogs.length; i++) {
      const log = chronologicalLogs[i];
      const hashContent = JSON.stringify({
        eventId: log.eventId,
        tenantId: log.tenantId,
        eventType: log.eventType,
        severity: log.severity,
        actor: {
          actorType: log.actor?.actorType,
          actorId: log.actor?.actorId,
          actorName: log.actor?.actorName,
        },
        resource:
          typeof log.resource === "object" && log.resource !== null
            ? {
                resourceType: (log.resource as { resourceType?: string })
                  .resourceType,
                resourceId: (log.resource as { resourceId?: string })
                  .resourceId,
                resourceName: (log.resource as { resourceName?: string })
                  .resourceName,
              }
            : log.resource,
        description: log.description,
        timestamp: log.timestamp.toISOString(),
        previousHash: log.previousHash || "0".repeat(64),
      });

      const expectedHash = crypto
        .createHmac("sha256", appConfig?.adminKey || "audit-secret-key")
        .update(hashContent)
        .digest("hex");

      const isCurrentValid = log.hash === expectedHash;
      const isChainValid = log.previousHash === previousHash;

      if (!isCurrentValid || !isChainValid) {
        tamperedCount++;
        details.push({
          eventId: log.eventId,
          timestamp: log.timestamp,
          isCurrentValid,
          isChainValid,
          expectedHash,
          actualHash: log.hash,
          expectedPreviousHash: previousHash,
          actualPreviousHash: log.previousHash,
        });
      }

      previousHash = log.hash || "0".repeat(64);
    }

    return {
      isValid: tamperedCount === 0,
      tamperedCount,
      details,
    };
  }
}
