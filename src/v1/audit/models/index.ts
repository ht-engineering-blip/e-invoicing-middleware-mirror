/**
 * Audit Models Export
 * Centralized export for all audit-related models
 */

export * from './audit-log.model';

// Type alias for backward compatibility with service layer
export type { AuditLogDocument as IAuditLog } from './audit-log.model';
