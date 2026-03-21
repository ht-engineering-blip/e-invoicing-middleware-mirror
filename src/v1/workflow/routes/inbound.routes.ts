import Elysia, { t } from "elysia";
import { requireAuth } from "../../../middlewares";
import { TenantService } from "../../tenants/services/tenant.service";
import { InboundWorkflowService } from "../services";
import { faker } from "@faker-js/faker/.";

/**
 * Admin-protected tenant routes
 * All mutation operations require admin key
 */
const inboundInvoiceRoutes = new Elysia({ prefix: '/inbound'})
  .use(requireAuth)
  .decorate('tenantService', new TenantService())
  .decorate('inboundWorkflowService', new InboundWorkflowService())
  /**
   * POST /api/v1/workflow/inbound
   * Run inbound invoice workflow
   */
  .post(
    '/',
    async ({ auth, body, query, tenantService, inboundWorkflowService }) => {
      try {
        console.log({ query })
        const transmit = Boolean(query.transmit === 'true');
        let invoice = body;
        let qrCode = await inboundWorkflowService.handleInboundWorkflow(invoice, transmit);
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
      body: t.Any({default: {}}),
      detail: {
        summary: 'Inbound Invoice',
        description: 'Process inbound workflow and transmit invoice',
       // hide: true
      },
      
    }
  )
 
  export default inboundInvoiceRoutes