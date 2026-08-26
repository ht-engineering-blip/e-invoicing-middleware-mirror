import { AuditEventType, AuditEventSeverity } from "../models/audit-log.model";

export interface CreateAuditLogInput {
  tenantId: string;
  eventType: AuditEventType;
  severity?: AuditEventSeverity;
  actorId: string;
  actorType?: "user" | "system" | "tenant" | "api_key";
  actorName?: string;
  resourceType: string;
  resourceId: string;
  resourceName?: string;
  description: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface ListAuditLogsInput {
  tenantId?: string;
  actorId?: string;
  eventType?: AuditEventType;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  limit?: number;
}

export interface GenerateReportInput {
  tenantId?: string;
  startDate: Date;
  endDate: Date;
  eventTypes?: AuditEventType[];
  resourceTypes?: string[];
  format?: "json" | "csv";
}

export interface AuditStatisticsInput {
  tenantId?: string;
  startDate: Date;
  endDate: Date;
  groupBy?: "eventType" | "severity" | "actorType" | "day";
}