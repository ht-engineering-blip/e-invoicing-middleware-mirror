// Audit module routes
import { Elysia } from "elysia";
import { requireAuth } from "../../middlewares/auth";
import { onlyAdmin } from "../auth/utils/access-checks";
import { AuditService } from "./services/audit.service";

export const auditRoutes = new Elysia({ prefix: "/audit" })
  .use(requireAuth)
  .decorate("auditService", new AuditService())
  .get("/", async ({ auth, query, auditService }) => {
    onlyAdmin(auth!, "Forbidden: Admin access required");
    const result = await auditService.listAuditLogs({
      tenantId: query.tenantId,
      actorId: query.actorId,
      eventType: query.eventType as any,
      resourceType: query.resourceType,
      resourceId: query.resourceId,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      skip: query.skip ? parseInt(query.skip) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
    return { success: true, data: result };
  })
  .get("/verify", async ({ auth, auditService }) => {
    onlyAdmin(auth!, "Forbidden: Admin access required");
    const result = await auditService.verifyIntegrity();
    return { success: true, data: result };
  })
  .get("/:eventId", async ({ auth, params, auditService }) => {
    onlyAdmin(auth!, "Forbidden: Admin access required");
    const log = await auditService.getAuditLog(params.eventId);
    return { success: true, data: log };
  })
  .get(
    "/resource/:resourceType/:resourceId",
    async ({ auth, params, auditService }) => {
      onlyAdmin(auth!, "Forbidden: Admin access required");
      const logs = await auditService.getResourceAuditTrail(
        params.resourceType,
        params.resourceId,
      );
      return { success: true, data: logs };
    },
  )
  .get("/statistics", async ({ auth, query, auditService }) => {
    onlyAdmin(auth!, "Forbidden: Admin access required");
    const result = await auditService.getStatistics({
      startDate: query.startDate
        ? new Date(query.startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: query.endDate ? new Date(query.endDate) : new Date(),
      tenantId: query.tenantId,
      groupBy: query.groupBy as any,
    });
    return { success: true, data: result };
  });
