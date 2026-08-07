import Elysia from "elysia";
import { requireAuth } from "../../../middlewares";
import { TenantService } from "../../tenants/services/tenant.service";
import { InboundWorkflowService } from "../services";
import { secureAndValidateInvoice } from "../utils/security";
import { inboundInvoiceValidation } from "../validations/inbound.validation";

/**
 * Admin-protected tenant routes
 * All mutation operations require admin key
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
    async ({ auth, body, query, tenantService, inboundWorkflowService, set }) => {
      try {
        console.log({ query });
        const transmit = Boolean(query.transmit === "true");

        const invoice = secureAndValidateInvoice(body, auth);

        let qrCode = await inboundWorkflowService.handleInboundWorkflow(
          invoice,
          transmit,
        );
        return { status: true, data: qrCode };
      } catch (error: any) {
        set.status = 500
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    inboundInvoiceValidation
  );

export default inboundInvoiceRoutes;
