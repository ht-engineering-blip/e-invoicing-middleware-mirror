import Elysia, { t } from 'elysia';
import { requireAuth } from '../../../middlewares';
import { TenantService } from '../../tenants/services/tenant.service';
import { InvoiceWorkflowService, InvoicePaymentStatus } from '../services';
import { TransformWorkflowService } from '../../workflow/services';
import { generateIRN } from '../../workflow/utils/transformer/utils';
import { generateRandomString } from '../../../@lib';
import { faker } from '@faker-js/faker/.';

/**
 * Invoice workflow routes
 * Individual endpoints for each step of the invoice workflow
 */
const invoiceMgmtRoutes = new Elysia()
  .use(requireAuth)
  .decorate('tenantService', new TenantService())
  .decorate('invoiceWorkflowService', new InvoiceWorkflowService())
  .decorate('transformWorkflowService', new TransformWorkflowService())

  /**
   * POST /api/v1/workflow/invoices/generate-irn
   * Generate Invoice Reference Number (IRN)
   */
  .post(
    '/generate-irn',
    async ({ auth, body, invoiceWorkflowService }) => {
      try {
        console.log({ auth })
        if (!auth?.businessId) {
          return { success: false, error: 'Business ID not found in auth context', statusCode: 401 };
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
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({
        invoiceNumber: t.String({ minLength: 1 }),
        issueDate: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Generate IRN',
        description: 'Generate a unique Invoice Reference Number (IRN) for an invoice',
        tags: ['Invoicing'],
      },
    }
  )

  /**
   * POST /api/v1/workflow/invoices/transform
   * Transform invoice to FIRS UBL format
   */
  .post(
    '/transform',
    async ({ auth, body, invoiceWorkflowService }) => {
      try {
        let invoice: any = body;
        if (auth?.businessId) {
          invoice.business_id = auth.businessId;
        } 
        if (!invoice.irn) {
          let generatedIRN = generateIRN(generateRandomString(13).substring(2, 8), auth?.serviceId)
          invoice.irn = generatedIRN
        }

        console.log({invoice})

        const result = await invoiceWorkflowService.transformInvoice(invoice, auth);

        return {
          success: true,
          data: result.data,
          workflowState: result.workflowState,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Any({ default: {} }),
      detail: {
        summary: 'Transform Invoice',
        description: 'Transform invoice data to FIRS UBL format',
        tags: ['Invoicing'],
      },
    }
  )

  /**
   * POST /api/v1/workflow/invoices/validate
   * Validate invoice against FIRS requirements
   */
  .post(
    '/validate',
    async ({ auth, body, invoiceWorkflowService }) => {
      try {
        if (!auth?.businessId) {
          return { success: false, error: 'Business ID not found in auth context', statusCode: 401 };
        }
        const result = await invoiceWorkflowService.validateInvoice(auth.businessId, body);

        return {
          success: result.success,
          valid: result.valid,
          data: result.data,
          errors: result.errors,
          workflowState: result.workflowState,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    { body: t.Any({ default: {} }),
      detail: {
        summary: 'Validate Invoice',
        description: 'Validate invoice against FIRS requirements',
        tags: ['Invoicing'],
      },
    }
  )

  /**
   * POST /api/v1/workflow/invoices/sign
   * Sign invoice using tenant credentials
   */
  .post(
    '/sign',
    async ({ auth, body, invoiceWorkflowService }) => {
      try {
        console.log({body})
        if (!auth?.businessId) {
          return { success: false, error: 'Business ID not found in auth context', statusCode: 401 };
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
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    { body: t.Any({ default: {} }),
      detail: {
        summary: 'Sign Invoice',
        description: 'Sign the invoice using tenant FIRS credentials',
        tags: ['Invoicing'],
      },
    }
  )

  /**
   * POST /api/v1/workflow/invoices/generate-qr
   * Generate QR code for invoice
   */
  .post(
    '/generate-qr',
    async ({ auth, body, invoiceWorkflowService }) => {
      try {
        if (!auth?.businessId) {
          return { success: false, error: 'Business ID not found in auth context', statusCode: 401 };
        }
        const result = await invoiceWorkflowService.generateQR(auth, body.irn);

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({
        irn: t.String({ minLength: 8 }),
      }),
      detail: {
        summary: 'Generate QR Code',
        description: 'Generate QR code for an invoice using tenant credentials',
        tags: ['Invoicing'],
      },
    }
  )

  /**
   * POST /api/v1/workflow/invoices/transmit
   * Transmit invoice to FIRS
   */
  .post(
    '/transmit',
    async ({ auth, body, invoiceWorkflowService }) => {
      try {
        if (!auth?.businessId) {
          return { success: false, error: 'Business ID not found in auth context', statusCode: 401 };
        }
        const result = await invoiceWorkflowService.transmitInvoice(auth, body.irn);

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({
        irn: t.String({ minLength: 1 }),
      }),
      detail: {
        summary: 'Transmit Invoice',
        description: 'Transmit signed invoice to FIRS',
        tags: ['Invoicing'],
      },
    }
  )

  /**
   * POST /api/v1/workflow/invoices/decrypt
   * Download and decrypt inbound invoice
   */
  .post(
    '/decrypt',
    async ({ body, invoiceWorkflowService }) => {
      try {
        const result = await invoiceWorkflowService.decryptInvoice(body.irn);

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({
        irn: t.String({ minLength: 1 }),
      }),
      detail: {
        summary: 'Decrypt Invoice',
        description: 'Download and decrypt an inbound invoice from FIRS',
        tags: ['Invoicing'],
      },
    }
  )

  /**
   * POST /api/v1/workflow/invoices/acknowledge
   * Acknowledge receipt of inbound invoice
   */
  .post(
    '/acknowledge',
    async ({ auth, body, invoiceWorkflowService }) => {
      try {
        if (!auth?.businessId) {
          return { success: false, error: 'Business ID not found in auth context', statusCode: 401 };
        }
        const result = await invoiceWorkflowService.acknowledgeInvoiceReceipt(
          auth.businessId,
          body.irn,
          body.message
        );

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({
        irn: t.String({ minLength: 1 }),
        message: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Acknowledge Invoice',
        description: 'Acknowledge receipt of an inbound invoice',
        tags: ['Invoicing'],
      },
    }
  )

  /**
   * PATCH /api/v1/workflow/invoices/:irn/status
   * Update invoice payment status
   */
  .patch(
    '/:irn/status',
    async ({ auth, params, body, invoiceWorkflowService }) => {
      try {
        if (!auth?.businessId) {
          return { success: false, error: 'Business ID not found in auth context', statusCode: 401 };
        }
        const result = await invoiceWorkflowService.updateInvoiceStatus(
          auth.businessId,
          params.irn,
          body.status as InvoicePaymentStatus,
          {
            paymentDate: body.paymentDate ? new Date(body.paymentDate) : undefined,
            paymentAmount: body.paymentAmount,
            paymentReference: body.paymentReference,
            rejectionReason: body.rejectionReason,
          }
        );

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      params: t.Object({
        irn: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        status: t.Union([
          t.Literal('PENDING'),
          t.Literal('PAID'),
          t.Literal('REJECTED'),
        ]),
        paymentDate: t.Optional(t.String()),
        paymentAmount: t.Optional(t.Number()),
        paymentReference: t.Optional(t.String()),
        rejectionReason: t.Optional(t.String()),
      }),
      detail: {
        summary: 'Update Invoice Status',
        description: 'Update the payment status of an invoice (PENDING, PAID, REJECTED)',
        tags: ['Invoicing'],
      },
    }
  )

  /**
   * POST /api/v1/workflow/invoices/report
   * Report invoice for VAT post-payment to FIRS
   */
  .post(
    '/report',
    async ({ auth, body, invoiceWorkflowService }) => {
      try {
        if (!auth?.businessId) {
          return { success: false, error: 'Business ID not found in auth context', statusCode: 401 };
        }

        const integratorServiceId = body.integrator_service_id || auth.serviceId;
        if (!integratorServiceId) {
          return { success: false, error: 'Integrator Service ID is required', statusCode: 400 };
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
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: t.Object({
        agent_tin: t.String({ minLength: 1, description: 'Accounting Supplier Party TIN' }),
        base_amount: t.String({ description: 'Line extension amount (amount to be taxed)' }),
        beneficiary_tin: t.String({ minLength: 1, description: 'Accounting Buyer Party TIN' }),
        currency: t.String({ default: 'NGN', description: 'Document currency code' }),
        item_description: t.String({ description: 'Item description within the invoice line' }),
        irn: t.String({ minLength: 1, description: 'Invoice Reference Number' }),
        other_taxes: t.String({ description: 'Summation of tax amount for Tax categories other than VAT' }),
        total_amount: t.String({ description: 'Payable amount (amount to be collected)' }),
        transaction_date: t.String({ description: 'Issue date (YYYY-MM-DD)' }),
        integrator_service_id: t.Optional(t.String({ description: 'Service ID of Access Point Provider (uses auth.serviceId if not provided)' })),
        vat_calculated: t.String({ description: 'Tax amount with VAT category (STANDARD_VAT, ZERO_VAT, REDUCED_VAT)' }),
        vat_rate: t.String({ description: 'Percentage attached to tax category ID (e.g., "7.5")' }),
        vat_status: t.Union([
          t.Literal('STANDARD_VAT'),
          t.Literal('ZERO_VAT'),
          t.Literal('REDUCED_VAT'),
        ], { description: 'Tax (VAT) ID related to VAT type' }),
      }),
      detail: {
        summary: 'Report VAT Post-Payment',
        description: 'Report invoice to FIRS for VAT post-payment reporting (/api/v1/vat/postpayment)',
        tags: ['Invoicing'],
      },
    }
  )

  /**
   * GET /api/v1/workflow/invoices/:irn/confirm
   * Confirm invoice status on FIRS
   */
  .get(
    '/:irn/confirm',
    async ({ auth, params, invoiceWorkflowService }) => {
      try {
        if (!auth?.businessId) {
          return { success: false, error: 'Business ID not found in auth context', statusCode: 401 };
        }
        const result = await invoiceWorkflowService.confirmInvoiceStatus(
          auth.businessId,
          params.irn
        );

        return {
          success: true,
          data: result,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      params: t.Object({
        irn: t.String({ minLength: 1 }),
      }),
      detail: {
        summary: 'Confirm Invoice Status',
        description: 'Confirm the status of an invoice on FIRS',
        tags: ['Invoicing'],
      },
    }
  );

export default invoiceMgmtRoutes;
