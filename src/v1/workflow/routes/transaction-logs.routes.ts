import { Elysia, t } from 'elysia';
import { requireAuth } from '../../../middlewares/auth';
import { logger } from '../../../@lib';
import { OutboundInvoiceRepository } from '../repos/outbound-invoice.repo';
import { InboundInvoiceRepository } from '../repos/inbound-invoice.repo';
import { AuditLogRepository } from '../../audit/repos/audit-log.repo';
import { OutboundWorkflowService } from '../services/workflows/outbound.service';
import { OutboundInvoiceStatus } from '../models/outbound-invoice.model';

/**
 * Transaction Logs Routes
 */
export const transactionLogsRoutes = new Elysia({ prefix: '/invoices' })
  .use(requireAuth)
  .decorate('outboundRepo', new OutboundInvoiceRepository())
  .decorate('inboundRepo', new InboundInvoiceRepository())
  .decorate('auditRepo', new AuditLogRepository())
  .decorate('outboundService', new OutboundWorkflowService())

  // ==================== OUTBOUND INVOICES ====================

  /**
   * GET /workflow/invoices/outbound
   * List outbound invoices with filtering and pagination
   */
  .get(
    '/outbound',
    async ({ query, auth, outboundRepo }) => {
      try {
        const page = parseInt(query.page || '1');
        const limit = Math.min(parseInt(query.limit || '20'), 100);
        const offset = (page - 1) * limit;

        // Build filters
        const filters: any = {
          tenantId: { _eq: auth!.tenantId },
        };

        if (query.status) {
          filters.status = { _eq: query.status };
        }

        if (query.from || query.to) {
          filters.createdAt = {};
          if (query.from) filters.createdAt._gte = new Date(query.from);
          if (query.to) filters.createdAt._lte = new Date(query.to);
        }

        const [invoices, total] = await Promise.all([
          outboundRepo.findMany(filters, undefined, limit, offset),
          outboundRepo.count(filters),
        ]);

        return {
          success: true,
          data: invoices.map((inv) => ({
            irn: inv.irn,
            invoiceNumber: inv.metadata?.invoiceNumber || inv.metadata?.InvoiceNumber,
            status: inv.status,
            workflowState: inv.workflowState,
            customerName: inv.metadata?.AccountingCustomerParty?.Party?.PartyName?.[0]?.Name,
            totalAmount: inv.metadata?.LegalMonetaryTotal?.PayableAmount?.value,
            currency: inv.metadata?.DocumentCurrencyCode,
            createdAt: inv.createdAt,
            updatedAt: inv.updatedAt,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };
      } catch (error: any) {
        logger.error('Failed to list outbound invoices', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to list outbound invoices',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        status: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Transaction Logs'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'List Outbound Invoices',
        description: 'List outbound invoices with filtering and pagination',
      },
    }
  )

  /**
   * GET /workflow/invoices/outbound/:irn
   * Get outbound invoice with status history
   */
  .get(
    '/outbound/:irn',
    async ({ params, auth, outboundRepo, auditRepo }) => {
      try {
        // Find invoice
        const invoice = await outboundRepo.findByIrn(params.irn);

        if (!invoice) {
          return {
            success: false,
            error: 'Invoice not found',
            statusCode: 404,
          };
        }

        // Check ownership
        if (invoice.tenantId !== auth!.tenantId && !auth!.isAdmin) {
          return {
            success: false,
            error: 'Not authorized to view this invoice',
            statusCode: 403,
          };
        }

        // Get status history from audit logs
        const auditResult = await auditRepo.findByResourceId(params.irn);
        const auditLogs = auditResult.data || [];

        const statusHistory = auditLogs.map((log: any) => ({
          status: log.metadata?.status || log.eventType,
          timestamp: log.timestamp,
          details: log.description,
        }));

        return {
          success: true,
          data: {
            invoice: {
              irn: invoice.irn,
              tenantId: invoice.tenantId,
              status: invoice.status,
              workflowState: invoice.workflowState,
              qrCode: invoice.qrCode,
              invoiceData: invoice.metadata,
              validationAttempts: invoice.validationAttempts,
              validationErrors: invoice.validationErrors,
              metadata: invoice.metadata,
              createdAt: invoice.createdAt,
              updatedAt: invoice.updatedAt,
            },
            statusHistory,
            webhookEvents: invoice.webhookEvents || [],
          },
        };
      } catch (error: any) {
        logger.error('Failed to get outbound invoice', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to get outbound invoice',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      params: t.Object({
        irn: t.String(),
      }),
      detail: {
        tags: ['Transaction Logs'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Get Outbound Invoice',
        description: 'Get outbound invoice with full status history',
      },
    }
  )

  /**
   * POST /workflow/invoices/outbound/:irn/resend
   * Resend failed invoice workflow
   */
  .post(
    '/outbound/:irn/resend',
    async ({ params, auth, outboundRepo, outboundService }) => {
      try {
        // Find invoice
        const invoice = await outboundRepo.findByIrn(params.irn);

        if (!invoice) {
          return {
            success: false,
            error: 'Invoice not found',
            statusCode: 404,
          };
        }

        // Check ownership
        if (invoice.tenantId !== auth!.tenantId && !auth!.isAdmin) {
          return {
            success: false,
            error: 'Not authorized',
            statusCode: 403,
          };
        }

        // Check if invoice is in failed state
        if (invoice.status !== OutboundInvoiceStatus.FAILED) {
          return {
            success: false,
            error: 'Only failed invoices can be resent',
            statusCode: 400,
          };
        }

        // Determine the failure point and restart from there
        const workflowState = invoice.workflowState;
        let restartFrom = 'validate';

        if (!workflowState?.validated) {
          restartFrom = 'validate';
        } else if (!workflowState?.signed) {
          restartFrom = 'sign';
        } else if (!workflowState?.transmitted) {
          restartFrom = 'transmit';
        }

        // Update status to allow retry
        await outboundRepo.updateStatus(params.irn, OutboundInvoiceStatus.VALIDATED);

        // Trigger workflow
        const result = await outboundService.handleOutboundWorkflow(invoice.metadata, true);

        return {
          success: true,
          message: 'Invoice workflow restarted',
          data: {
            irn: params.irn,
            restartedFrom: restartFrom,
            result: result,
          },
        };
      } catch (error: any) {
        logger.error('Failed to resend invoice', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to resend invoice',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      params: t.Object({
        irn: t.String(),
      }),
      detail: {
        tags: ['Transaction Logs'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Resend Failed Invoice',
        description: 'Restart workflow for a failed invoice',
      },
    }
  )

  // ==================== INBOUND INVOICES ====================

  /**
   * GET /workflow/invoices/inbound
   * List inbound invoices with filtering and pagination
   */
  .get(
    '/inbound',
    async ({ query, auth, inboundRepo }) => {
      try {
        const page = parseInt(query.page || '1');
        const limit = Math.min(parseInt(query.limit || '20'), 100);
        const offset = (page - 1) * limit;

        // Build filters
        const filters: any = {};

        // Filter by businessId or tenantId
        if (auth!.businessId) {
          filters.businessId = { _eq: auth!.businessId };
        } else {
          filters.tenantId = { _eq: auth!.tenantId };
        }

        if (query.status) {
          filters.status = { _eq: query.status };
        }

        if (query.paymentStatus) {
          filters.paymentStatus = { _eq: query.paymentStatus };
        }

        if (query.from || query.to) {
          filters.createdAt = {};
          if (query.from) filters.createdAt._gte = new Date(query.from);
          if (query.to) filters.createdAt._lte = new Date(query.to);
        }

        const [invoices, total] = await Promise.all([
          inboundRepo.findMany(filters, undefined, limit, offset),
          inboundRepo.count(filters),
        ]);

        return {
          success: true,
          data: invoices.map((inv) => ({
            irn: inv.irn,
            invoiceNumber: inv.invoiceNumber,
            supplierName: inv.supplierName,
            supplierTIN: inv.supplierTIN,
            status: inv.status,
            paymentStatus: inv.paymentStatus,
            totalAmount: inv.totalAmount,
            currency: inv.currency,
            issueDate: inv.issueDate,
            dueDate: inv.dueDate,
            receivedAt: inv.createdAt,
          })),
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };
      } catch (error: any) {
        logger.error('Failed to list inbound invoices', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to list inbound invoices',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        status: t.Optional(t.String()),
        paymentStatus: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Transaction Logs'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'List Inbound Invoices',
        description: 'List inbound invoices with filtering and pagination',
      },
    }
  )

  /**
   * GET /workflow/invoices/inbound/:irn
   * Get inbound invoice with status history
   */
  .get(
    '/inbound/:irn',
    async ({ params, auth, inboundRepo, auditRepo }) => {
      try {
        // Find invoice
        const invoice = await inboundRepo.findByIRN(params.irn);

        if (!invoice) {
          return {
            success: false,
            error: 'Invoice not found',
            statusCode: 404,
          };
        }

        // Check ownership
        const isOwner =
          invoice.tenantId === auth!.tenantId ||
          invoice.businessId === auth!.businessId ||
          auth!.isAdmin;

        if (!isOwner) {
          return {
            success: false,
            error: 'Not authorized to view this invoice',
            statusCode: 403,
          };
        }

        // Get status history from audit logs
        const auditResult = await auditRepo.findByResourceId(params.irn);
        const auditLogs = auditResult.data || [];

        const statusHistory = auditLogs.map((log: any) => ({
          status: log.metadata?.status || log.eventType,
          timestamp: log.timestamp,
          details: log.description,
        }));

        return {
          success: true,
          data: {
            invoice: {
              irn: invoice.irn,
              invoiceNumber: invoice.invoiceNumber,
              tenantId: invoice.tenantId,
              businessId: invoice.businessId,
              status: invoice.status,
              paymentStatus: invoice.paymentStatus,
              supplierTIN: invoice.supplierTIN,
              supplierName: invoice.supplierName,
              supplierAddress: invoice.supplierAddress,
              totalAmount: invoice.totalAmount,
              currency: invoice.currency,
              issueDate: invoice.issueDate,
              dueDate: invoice.dueDate,
              decryptedData: invoice.decryptedData,
              workflowState: invoice.workflowState,
              paymentDetails: invoice.paymentDetails,
              metadata: invoice.metadata,
              createdAt: invoice.createdAt,
              updatedAt: invoice.updatedAt,
            },
            statusHistory,
          },
        };
      } catch (error: any) {
        logger.error('Failed to get inbound invoice', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to get inbound invoice',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      params: t.Object({
        irn: t.String(),
      }),
      detail: {
        tags: ['Transaction Logs'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Get Inbound Invoice',
        description: 'Get inbound invoice with full details and status history',
      },
    }
  );
