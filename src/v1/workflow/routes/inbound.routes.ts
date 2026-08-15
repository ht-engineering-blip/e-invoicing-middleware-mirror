import Elysia from "elysia";
import { requireAuth } from "../../../middlewares";
import { logger, ResponseBuilder } from "../../../@lib";
import { TenantService } from "../../tenants/services/tenant.service";
import { InboundWorkflowService } from "../services";
import { secureAndValidateInvoice } from "../utils/security";
import { inboundInvoiceValidation } from "../validations/inbound.validation";

/**
 * Inbound invoice routes
 */
const inboundInvoiceRoutes = new Elysia({ prefix: "/inbound" })
  .use(requireAuth)
  .decorate("tenantService", new TenantService())
  .decorate("inboundWorkflowService", new InboundWorkflowService())
  /**
   * POST /api/v1/workflow/inbound
   * Run inbound invoice workflow
   */
  .post(
    "/",
    async ({ auth, body, query, inboundWorkflowService, set }) => {
      try {
        const transmit = Boolean(query?.transmit === "true");
        const invoice = secureAndValidateInvoice(body, auth);

        const result = await inboundWorkflowService.handleInboundWorkflow(
          invoice,
          transmit,
        );

        if (!result.status) {
          set.status = 400;
          return ResponseBuilder.error(
            result.error || "Inbound workflow failed",
            400
          );
        }

        return ResponseBuilder.success(
          result.data,
          undefined,
          "Inbound invoice processed successfully"
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Inbound workflow route error:", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to process inbound invoice",
          error.statusCode || 500
        );
      }
    },
    inboundInvoiceValidation,
  );

export default inboundInvoiceRoutes;

