import Elysia from "elysia";
import { requireAuth } from "../../../middlewares";
import { TenantService } from "../../tenants/services/tenant.service";
import { InvoiceWorkflowService } from "../services";
import { TransformWorkflowService } from "../../workflow/services";
import { generateIRN } from "../../workflow/utils/transformer/utils";
import { generateRandomString, logger } from "../../../@lib";
import { scheduleJobChain } from "../../workflow/jobs/orchestrator";
import {
  generateIrnValidation,
  transformInvoiceValidation,
  validateInvoiceValidation,
  signInvoiceValidation,
  generateQRValidation,
  transmitInvoiceValidation,
  decryptInvoiceValidation,
  acknowledgeInvoiceValidation,
  updateInvoiceStatusValidation,
  reportVATValidation,
  confirmInvoiceStatusValidation,
} from "../validations/invoices.validation";

/**
 * Invoice workflow routes
 * Individual endpoints for each step of the invoice workflow
 */
const invoiceMgmtRoutes = new Elysia()
  .use(requireAuth)
  .decorate("tenantService", new TenantService())
  .decorate("invoiceWorkflowService", new InvoiceWorkflowService())
  .decorate("transformWorkflowService", new TransformWorkflowService())

  /**
   * POST /api/v1/workflow/invoices/generate-irn
   * Generate Invoice Reference Number (IRN)
   */
  .post(
    "/generate-irn",
    async ({ auth, body, invoiceWorkflowService, set }) => {
      try {
        console.log({ auth });
        if (!auth?.businessId) {
          set.status = 401;
          return {
            success: false,
            error: "Business ID not found in auth context",
            statusCode: 401,
          };
        }
        const irn = await generateIRN(
          body.invoiceNumber,
          auth.serviceId,
          body.issueDate ? new Date(body.issueDate) : undefined,
        );

        return {
          success: true,
          data: { irn, generated: true },
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    generateIrnValidation,
  )

  /**
   * POST /api/v1/workflow/invoices/transform
   * Transform invoice to FIRS UBL format
   */
  .post(
    "/transform",
    async ({ auth, body, invoiceWorkflowService, set }) => {
      try {
        let invoice: any = body;
        if (auth?.businessId) {
          invoice.business_id = auth.businessId;
        }
        if (!invoice.irn) {
          let generatedIRN = generateIRN(
            generateRandomString(13).substring(2, 8),
            auth?.serviceId,
          );
          invoice.irn = generatedIRN;
        }

        console.log({ invoice });

        const result = await invoiceWorkflowService.transformInvoice(
          invoice,
          auth,
        );

        return {
          success: true,
          data: result.data,
          workflowState: result.workflowState,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    transformInvoiceValidation,
  )

  /**
   * POST /api/v1/workflow/invoices/validate
   * Validate invoice against FIRS requirements
   */
  .post(
    "/validate",
    async ({ auth, body, invoiceWorkflowService, set }) => {
      try {
        if (!auth?.businessId) {
          set.status = 401;
          return {
            success: false,
            error: "Business ID not found in auth context",
            statusCode: 401,
          };
        }
        const result = await invoiceWorkflowService.validateInvoice(
          auth.businessId,
          body,
        );

        return {
          success: result.success,
          valid: result.valid,
          data: result.data,
          errors: result.errors,
          workflowState: result.workflowState,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    validateInvoiceValidation,
  )

  /**
   * POST /api/v1/workflow/invoices/sign
   * Sign invoice using tenant credentials
   */
  .post(
    "/sign",
    async ({ auth, body, invoiceWorkflowService, set }) => {
      try {
        console.log({ body });
        if (!auth?.businessId) {
          set.status = 401;
          return {
            success: false,
            error: "Business ID not found in auth context",
            statusCode: 401,
          };
        }
        const result = await invoiceWorkflowService.signInvoice(auth, body);

        return {
          success: result.success,
          signed: result.signed,
          data: result.data,
          errors: result.errors,
          workflowState: result.workflowState,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    signInvoiceValidation,
  )

  /**
   * POST /api/v1/workflow/invoices/generate-qr
   * Generate QR code for invoice
   */
  .post(
    "/generate-qr",
    async ({ auth, body, invoiceWorkflowService, set }) => {
      try {
        if (!auth?.businessId) {
          return {
            success: false,
            error: "Business ID not found in auth context",
            statusCode: 401,
          };
        }
        const result = await invoiceWorkflowService.generateQR(auth, body.irn);

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    generateQRValidation,
  )

  /**
   * POST /api/v1/workflow/invoices/transmit
   * Transmit invoice to FIRS
   */
  .post(
    "/transmit",
    async ({ auth, body, invoiceWorkflowService, set }) => {
      try {
        if (!auth?.businessId) {
          set.status = 401;
          return {
            success: false,
            error: "Business ID not found in auth context",
            statusCode: 401,
          };
        }
        const result = await invoiceWorkflowService.transmitInvoice(
          auth,
          body.irn,
        );

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    transmitInvoiceValidation,
  )

  /**
   * POST /api/v1/workflow/invoices/decrypt
   * Download and decrypt inbound invoice
   */
  .post(
    "/decrypt",
    async ({ auth, body, invoiceWorkflowService, set }) => {
      try {
        if (!auth?.businessId) {
          set.status = 401;
          return {
            success: false,
            error: "Business ID not found in auth context",
            statusCode: 401,
          };
        }
        const result = await invoiceWorkflowService.decryptInvoice(
          auth,
          body.irn,
        );

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    decryptInvoiceValidation,
  )

  /**
   * POST /api/v1/workflow/invoices/acknowledge
   * Acknowledge receipt of inbound invoice
   */
  .post(
    "/acknowledge",
    async ({ auth, body, invoiceWorkflowService, set }) => {
      try {
        if (!auth?.businessId) {
          set.status = 401;
          return {
            success: false,
            error: "Business ID not found in auth context",
            statusCode: 401,
          };
        }
        const result = await invoiceWorkflowService.acknowledgeInvoiceReceipt(
          auth.businessId,
          body.irn,
          body.message,
        );

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    acknowledgeInvoiceValidation,
  )

  /**
   * PATCH /api/v1/workflow/invoices/:irn/status
   * Update invoice payment status
   */
  .patch(
    "/:irn/status",
    async ({ auth, params, body, invoiceWorkflowService, set }) => {
      try {
        if (!auth?.tenantId) {
          set.status = 401;
          return {
            success: false,
            error: "Tenant ID not found in auth context",
            statusCode: 401,
          };
        }
        const result = await invoiceWorkflowService.updateInvoiceStatus(
          auth.tenantId,
          params.irn,
          body.status as any,
          {
            paymentDate: body.paymentDate
              ? new Date(body.paymentDate)
              : undefined,
            paymentAmount: body.paymentAmount,
            paymentReference: body.paymentReference,
            rejectionReason: body.rejectionReason,
          },
        );

        // run a job to update invoice status to FIRS
        scheduleJobChain({
          webhookEventId: `status_${params.irn}_${Date.now()}`,
          tenantId: auth.tenantId,
          eventType: "invoice." + body.status.toLowerCase(),
          actions: ["update_payment_status"],
          payload: {
            irn: params.irn,
            vatReportData: {
              payment_status: body.status,
              reference: body.paymentReference,
            },
          },
          irn: params.irn,
        }).catch((err) =>
          logger.error(
            "[invoices.routes] Failed to schedule update-payment-status job",
            {
              irn: params.irn,
              error: err.message,
            },
          ),
        );

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    updateInvoiceStatusValidation,
  )

  /**
   * POST /api/v1/workflow/invoices/report
   * Report invoice for VAT post-payment to FIRS
   */
  .post(
    "/report",
    async ({ auth, body, invoiceWorkflowService, set }) => {
      try {
        if (!auth?.businessId) {
          set.status = 401;
          return {
            success: false,
            error: "Business ID not found in auth context",
            statusCode: 401,
          };
        }

        const integratorServiceId =
          body.integrator_service_id || auth.serviceId;
        if (!integratorServiceId) {
          return {
            success: false,
            error: "Integrator Service ID is required",
            statusCode: 400,
          };
        }

        const result = await invoiceWorkflowService.reportInvoice({
          agent_tin: body.agent_tin,
          base_amount: body.base_amount,
          beneficiary_tin: body.beneficiary_tin,
          currency: body.currency,
          item_description: body.item_description,
          irn: body.irn,
          other_taxes: body.other_taxes,
          total_amount: body.total_amount,
          transaction_date: body.transaction_date,
          integrator_service_id: integratorServiceId,
          vat_calculated: body.vat_calculated,
          vat_rate: body.vat_rate,
          vat_status: body.vat_status,
        });

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    reportVATValidation,
  )

  /**
   * GET /api/v1/workflow/invoices/:irn/confirm
   * Confirm invoice status on FIRS
   */
  .get(
    "/:irn/confirm",
    async ({ auth, params, invoiceWorkflowService, set }) => {
      try {
        if (!auth?.businessId) {
          set.status = 401;
          return {
            success: false,
            error: "Business ID not found in auth context",
            statusCode: 401,
          };
        }
        const result = await invoiceWorkflowService.confirmInvoiceStatus(
          auth.businessId,
          params.irn,
        );

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        set.status = 500;
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    confirmInvoiceStatusValidation,
  );

export default invoiceMgmtRoutes;
