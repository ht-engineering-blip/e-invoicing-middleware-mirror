import { t } from "elysia";
import { AuditEventType, AuditEventSeverity } from "../models/audit-log.model";

/**
 * Validator for listing audit logs query parameters
 */
export const listAuditLogsQueryValidator = t.Object({
  tenantId: t.Optional(
    t.String({
      description: "Filter by tenant ID",
      examples: ["BIZ_1234567890"],
    }),
  ),
  actorId: t.Optional(
    t.String({
      description: "Filter by actor ID (user ID, tenant ID, or system component)",
      examples: ["user_abc123", "system"],
    }),
  ),
  eventType: t.Optional(
    t.String({
      description: "Filter by audit event type",
      examples: ["tenant.created", "tenant.updated", "api_key.created", "invoice.submitted"],
    }),
  ),
  resourceType: t.Optional(
    t.String({
      description: "Filter by resource type (tenant, api_key, invoice, system_config, onboarding, event_routing)",
      examples: ["tenant", "api_key", "invoice", "system_config"],
    }),
  ),
  resourceId: t.Optional(
    t.String({
      description: "Filter by specific resource identifier",
      examples: ["BIZ_1234567890", "key_abc123"],
    }),
  ),
  startDate: t.Optional(
    t.String({
      description: "Filter logs starting from this date (ISO 8601 string)",
      examples: ["2026-01-01T00:00:00.000Z"],
    }),
  ),
  endDate: t.Optional(
    t.String({
      description: "Filter logs up to this date (ISO 8601 string)",
      examples: ["2026-12-31T23:59:59.999Z"],
    }),
  ),
  skip: t.Optional(
    t.Numeric({
      description: "Number of records to skip for pagination (default: 0)",
      default: 0,
      minimum: 0,
    }),
  ),
  limit: t.Optional(
    t.Numeric({
      description: "Maximum number of records to return (default: 50, max: 200)",
      default: 50,
      minimum: 1,
      maximum: 200,
    }),
  ),
});

/**
 * Validator for audit statistics query parameters
 */
export const auditStatisticsQueryValidator = t.Object({
  startDate: t.Optional(
    t.String({
      description: "Start date for statistics (ISO 8601 string, default: 30 days ago)",
      examples: ["2026-01-01T00:00:00.000Z"],
    }),
  ),
  endDate: t.Optional(
    t.String({
      description: "End date for statistics (ISO 8601 string, default: current time)",
      examples: ["2026-02-26T23:59:59.999Z"],
    }),
  ),
  tenantId: t.Optional(
    t.String({
      description: "Filter statistics for a specific tenant ID",
      examples: ["BIZ_1234567890"],
    }),
  ),
  groupBy: t.Optional(
    t.Union([
      t.Literal("eventType"),
      t.Literal("severity"),
      t.Literal("day"),
      t.Literal("actorType"),
    ], {
      description: "Aggregation dimension (default: eventType)",
      default: "eventType",
    }),
  ),
});

/**
 * Event ID parameter validator
 */
export const eventIdParamValidator = t.Object({
  eventId: t.String({
    description: "Unique event identifier (e.g. evt_1740582000000_abc123)",
    examples: ["evt_1740582000000_abc123"],
  }),
});

/**
 * Resource audit trail parameter validator
 */
export const resourceParamValidator = t.Object({
  resourceType: t.String({
    description: "Resource category (e.g. tenant, api_key, invoice, system_config)",
    examples: ["tenant", "api_key", "invoice"],
  }),
  resourceId: t.String({
    description: "Resource identifier",
    examples: ["BIZ_1234567890"],
  }),
});

/**
 * Route Validation Configurations for OpenAPI/Scalar
 */
export const listAuditLogsValidation = {
  query: listAuditLogsQueryValidator,
  detail: {
    tags: ["Audit"],
    security: [{ adminKey: [] as string[] }],
    summary: "List Audit Logs",
    description: "Retrieve a paginated list of audit trail events with multi-dimensional filtering (by tenant, actor, event type, resource, or date range).",
  },
};

export const getAuditStatisticsValidation = {
  query: auditStatisticsQueryValidator,
  detail: {
    tags: ["Audit"],
    security: [{ adminKey: [] as string[] }],
    summary: "Get Audit Statistics",
    description: "Calculate aggregated audit log statistics grouped by event type, severity, day, or actor type across a specified date range.",
  },
};

export const verifyAuditIntegrityValidation = {
  detail: {
    tags: ["Audit"],
    security: [{ adminKey: [] as string[] }],
    summary: "Verify Audit Integrity",
    description: "Verify the cryptographic hash chain and HMAC signatures of audit log entries to guarantee tamper-evident non-repudiation.",
  },
};

export const getAuditLogByIdValidation = {
  params: eventIdParamValidator,
  detail: {
    tags: ["Audit"],
    security: [{ adminKey: [] as string[] }],
    summary: "Get Audit Log by Event ID",
    description: "Retrieve complete event details, actor info, changes, and payload metadata for a specific audit log event ID.",
  },
};

export const getResourceAuditTrailValidation = {
  params: resourceParamValidator,
  detail: {
    tags: ["Audit"],
    security: [{ adminKey: [] as string[] }],
    summary: "Get Resource Audit Trail",
    description: "Retrieve the complete chronological lifecycle history and mutation audit records for a given resource type and ID.",
  },
};
