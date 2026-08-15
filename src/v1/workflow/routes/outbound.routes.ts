import Elysia from "elysia";
import { requireAuth } from "../../../middlewares";
import { logger, ResponseBuilder } from "../../../@lib";
import { TenantService } from "../../tenants/services/tenant.service";
import { OutboundWorkflowService } from "../services";
import { secureAndValidateInvoice } from "../utils/security";
import { outboundInvoiceValidation } from "../validations/outbound.validation";

/**
 * Outbound invoice routes
 */
const outboundInvoiceRoutes = new Elysia({ prefix: "/outbound" })
  .use(requireAuth)
  .decorate("tenantService", new TenantService())
  .decorate("outboundWorkflowService", new OutboundWorkflowService())

  /**
   * POST /api/v1/workflow/outbound
   * Run outbound invoice workflow
   */
  .post(
    "/",
    async ({ auth, body, query, outboundWorkflowService, set }) => {
      try {
        const transmit = Boolean(query?.transmit === "true");
        const invoice = secureAndValidateInvoice(body, auth);

        const result = await outboundWorkflowService.handleOutboundWorkflow(
          invoice,
          transmit,
        );

        return ResponseBuilder.success(
          result,
          undefined,
          "Outbound invoice processed successfully"
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Outbound workflow route error:", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to process outbound invoice",
          error.statusCode || 500
        );
      }
    },
    outboundInvoiceValidation
  );

export default outboundInvoiceRoutes;

