// Audit module routes
import { Elysia } from "elysia";
import { requireAuth } from "../../middlewares/auth";
import { onlyAdmin } from "../auth/utils/access-checks";
import { AuditService } from "./services/audit.service";
import { ResponseBuilder } from "../../@lib";
import {
  listAuditLogsValidation,
  getAuditStatisticsValidation,
  verifyAuditIntegrityValidation,
  getAuditLogByIdValidation,
  getResourceAuditTrailValidation,
} from "./validations/audit.validation";

export const auditRoutes = new Elysia({
  prefix: "/audit",
})
  .use(requireAuth)
  .decorate("auditService", new AuditService())

  /**
   * GET /api/v1/audit
   * List audit logs with pagination and filters
   */
  .get(
    "/",
    async ({ auth, query, auditService }) => {
      onlyAdmin(auth!, "Forbidden: Admin access required");
      const result = await auditService.listAuditLogs({
        tenantId: query.tenantId,
        actorId: query.actorId,
        eventType: query.eventType as any,
        resourceType: query.resourceType,
        resourceId: query.resourceId,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        skip: query.skip ? Number(query.skip) : 0,
        limit: query.limit ? Number(query.limit) : 50,
      });

      return ResponseBuilder.paginate(
        result.logs,
        result.total,
        Math.floor(result.skip / result.limit) + 1,
        result.limit,
      );
    },
    listAuditLogsValidation,
  )

  /**
   * GET /api/v1/audit/statistics
   * Aggregated audit statistics
   */
  .get(
    "/statistics",
    async ({ auth, query, auditService }) => {
      onlyAdmin(auth!, "Forbidden: Admin access required");
      const result = await auditService.getStatistics({
        startDate: query.startDate
          ? new Date(query.startDate)
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: query.endDate ? new Date(query.endDate) : new Date(),
        tenantId: query.tenantId,
        groupBy: query.groupBy as any,
      });

      return ResponseBuilder.success(
        result,
        undefined,
        "Audit statistics retrieved successfully",
      );
    },
    getAuditStatisticsValidation,
  )

  /**
   * GET /api/v1/audit/verify
   * Verify audit cryptographic log integrity
   */
  .get(
    "/verify",
    async ({ auth, auditService }) => {
      onlyAdmin(auth!, "Forbidden: Admin access required");
      const result = await auditService.verifyIntegrity();
      return ResponseBuilder.success(
        result,
        undefined,
        "Audit integrity verification completed",
      );
    },
    verifyAuditIntegrityValidation,
  )

  /**
   * GET /api/v1/audit/:eventId
   * Retrieve single audit log event by ID
   */
  .get(
    "/:eventId",
    async ({ auth, params, auditService }) => {
      onlyAdmin(auth!, "Forbidden: Admin access required");
      const log = await auditService.getAuditLog(params.eventId);
      return ResponseBuilder.success(log);
    },
    getAuditLogByIdValidation,
  )

  /**
   * GET /api/v1/audit/resource/:resourceType/:resourceId
   * Retrieve complete audit trail for a resource
   */
  .get(
    "/resource/:resourceType/:resourceId",
    async ({ auth, params, auditService }) => {
      onlyAdmin(auth!, "Forbidden: Admin access required");
      const logs = await auditService.getResourceAuditTrail(
        params.resourceType,
        params.resourceId,
      );
      return ResponseBuilder.success(
        logs,
        undefined,
        "Resource audit trail retrieved",
      );
    },
    getResourceAuditTrailValidation,
  );
