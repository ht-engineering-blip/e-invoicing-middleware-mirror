import Elysia from "elysia";
import { requireAuth } from "../../../middlewares";
import { TenantService } from "../../tenants/services/tenant.service";
import { OutboundWorkflowService } from "../services";
import { secureAndValidateInvoice } from "../utils/security";
import { outboundInvoiceValidation } from "../validations/outbound.validation";

/**
 * Admin-protected tenant routes
 * All mutation operations require admin key
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
    async ({ auth, body, query, tenantService, outboundWorkflowService }) => {
      try {
        console.log({ query });
        const transmit = Boolean(query.transmit === "true");
        const invoice = secureAndValidateInvoice(body as SecureInvoice, auth);

        let qrCode = await outboundWorkflowService.handleOutboundWorkflow(
          invoice,
          transmit,
        );
        return { status: true, data: qrCode };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    outboundInvoiceValidation
  );

export default outboundInvoiceRoutes;
