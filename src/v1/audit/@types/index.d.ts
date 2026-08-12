
interface CreateAuditLogInput {
    tenantId: string;
    eventType: AuditEventType;
    severity?: AuditEventSeverity;
    actorId: string;
    actorType?: 'user' | 'system' | 'tenant' | 'api_key';
    actorName?: string;
    resourceType: string;
    resourceId: string;
    resourceName?: string;
    description: string;
    metadata?: any;
    ipAddress?: string;
    userAgent?: string;
}

interface ListAuditLogsInput {
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

interface GenerateReportInput {
    tenantId?: string;
    startDate: Date;
    endDate: Date;
    eventTypes?: AuditEventType[];
    resourceTypes?: string[];
    format?: 'json' | 'csv';
}

interface AuditStatisticsInput {
    tenantId?: string;
    startDate: Date;
    endDate: Date;
    groupBy?: 'eventType' | 'severity' | 'actorType' | 'day';
}