import Elysia, { t } from "elysia";
import { requireAuth } from "../../../middlewares";
import { TenantService } from "../../tenants/services/tenant.service";
import { OutboundWorkflowService } from "../services";
import { faker } from "@faker-js/faker";

/**
 * Admin-protected tenant routes
 * All mutation operations require admin key
 */
const outboundInvoiceRoutes = new Elysia({ prefix: '/outbound'})
  .use(requireAuth)
  .decorate('tenantService', new TenantService())
  .decorate('outboundWorkflowService', new OutboundWorkflowService())


  /**
   * POST /api/v1/workflow/outbound
   * Run outbound invoice workflow
   */
  .post(
    '/',
    async ({ auth, body, query, tenantService, outboundWorkflowService }) => {
      try {
          console.log({ query })
        const transmit = Boolean(query.transmit === 'true');
        let invoice = body;
        let qrCode = await outboundWorkflowService.handleOutboundWorkflow(invoice, transmit);
        return { status: true, data: qrCode };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({}),
      detail: { 
        summary: 'Outbound Invoice',
        description: 'Process outbound invoice workflow, from validation to signing and reporting.',
      },
    }
  )
 
  export default outboundInvoiceRoutes