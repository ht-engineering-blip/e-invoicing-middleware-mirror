import { t } from 'elysia';

/**
 * Audit Validators
 * Elysia validators for audit-related API endpoints
 */

/**
 * List Audit Logs Query Validator
 */
export const listAuditLogsQueryValidator = t.Object({
  page: t.Optional(t.Number({ minimum: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  eventType: t.Optional(t.String()),
  severity: t.Optional(
    t.Union([
      t.Literal('info'),
      t.Literal('warning'),
      t.Literal('error'),
      t.Literal('critical'),
    ])
  ),
  actorId: t.Optional(t.String()),
  actorType: t.Optional(
    t.Union([t.Literal('user'), t.Literal('system'), t.Literal('tenant'), t.Literal('api_key')])
  ),
  resourceId: t.Optional(t.String()),
  resourceType: t.Optional(t.String()),
  startDate: t.Optional(t.String({ format: 'date' })),
  endDate: t.Optional(t.String({ format: 'date' })),
  sortBy: t.Optional(t.String()),
  sortOrder: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
});

/**
 * Audit Event ID Path Parameter Validator
 */
export const auditEventIdParamValidator = t.Object({
  eventId: t.String(),
});

/**
 * Resource Audit Trail Query Validator
 */
export const resourceAuditTrailQueryValidator = t.Object({
  resourceId: t.String({ minLength: 1 }),
  resourceType: t.Optional(t.String()),
  page: t.Optional(t.Number({ minimum: 1 })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
});

/**
 * Generate Audit Report Validator
 */
export const generateAuditReportValidator = t.Object({
  reportType: t.Union([
    t.Literal('compliance'),
    t.Literal('security'),
    t.Literal('invoice_activity'),
    t.Literal('tenant_activity'),
  ]),
  startDate: t.String({ format: 'date' }),
  endDate: t.String({ format: 'date' }),
  tenantId: t.Optional(t.String()),
  format: t.Optional(t.Union([t.Literal('json'), t.Literal('csv'), t.Literal('pdf')])),
  includeDetails: t.Optional(t.Boolean()),
});

/**
 * Export Audit Logs Validator
 */
export const exportAuditLogsValidator = t.Object({
  startDate: t.String({ format: 'date' }),
  endDate: t.String({ format: 'date' }),
  eventTypes: t.Optional(t.Array(t.String())),
  severity: t.Optional(
    t.Array(
      t.Union([
        t.Literal('info'),
        t.Literal('warning'),
        t.Literal('error'),
        t.Literal('critical'),
      ])
    )
  ),
  format: t.Union([t.Literal('json'), t.Literal('csv')]),
});

/**
 * Audit Statistics Query Validator
 */
export const auditStatisticsQueryValidator = t.Object({
  startDate: t.String({ format: 'date' }),
  endDate: t.String({ format: 'date' }),
  groupBy: t.Optional(
    t.Union([
      t.Literal('eventType'),
      t.Literal('severity'),
      t.Literal('actorType'),
      t.Literal('day'),
      t.Literal('hour'),
    ])
  ),
});
