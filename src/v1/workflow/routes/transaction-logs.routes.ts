import { Elysia, t } from 'elysia';
import { requireAuth } from '../../../middlewares/auth';
import { logger } from '../../../@lib';
import { agenda } from '../../../@lib/queue/agenda';
import { OutboundInvoiceRepository } from '../repos/outbound-invoice.repo';
import { InboundInvoiceRepository } from '../repos/inbound-invoice.repo';
import { AuditLogRepository } from '../../audit/repos/audit-log.repo';
import { WebhookEventRepository } from '../../webhook/repos/webhook-event.repo';
import { OutboundWorkflowService } from '../services/workflows/outbound.service';
import {
  IOutboundPaymentDetails,
  OutboundInvoiceStatus,
  OutboundPaymentStatus,
} from '../models/outbound-invoice.model';
import { scheduleJobChain } from '../jobs/orchestrator';
import { ACTION_TO_JOB } from '../jobs/types';

/**
 * Transaction Logs Routes
 */
export const transactionLogsRoutes = new Elysia({ prefix: '/invoices' })
  .use(requireAuth)
  .decorate('outboundRepo', new OutboundInvoiceRepository())
  .decorate('inboundRepo', new InboundInvoiceRepository())
  .decorate('auditRepo', new AuditLogRepository())
  .decorate('webhookEventRepo', new WebhookEventRepository())
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
        const filters: any = {};
        if (!auth?.isAdmin) {
          filters.tenantId = { _eq: auth!.tenantId };
        }

        if (query.status) filters.status = { _eq: query.status };
        if (query.source) filters.source = { _eq: query.source };
        if (query.erpInvoiceId) filters.erpInvoiceId = { _eq: query.erpInvoiceId };

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
            erpInvoiceId: inv.erpInvoiceId,
            source: inv.source,
            invoiceNumber: inv.metadata?.invoiceNumber || inv.metadata?.InvoiceNumber,
            status: inv.status,
            paymentStatus: inv.paymentStatus,
            qrCode: inv.qrCode,
            erp: inv.erpSystem,
            workflowState: inv.workflowState,
            lastJobError: inv.lastJobError,
            customerName: inv.metadata?.AccountingCustomerParty?.Party?.PartyName?.[0]?.Name,
            totalAmount: inv.metadata?.LegalMonetaryTotal?.PayableAmount?.value,
            currency: inv.metadata?.DocumentCurrencyCode,
            webhookEventCount: (inv.webhookEvents ?? []).length,
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
        source: t.Optional(t.String()),
        erpInvoiceId: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Transaction Logs'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'List Outbound Invoices',
        description: 'List outbound invoices with filtering and pagination. Filter by source=webhook|api or erpInvoiceId.',
      },
    }
  )

  /**
   * GET /workflow/invoices/outbound/:irn
   * Get outbound invoice with status history
   */
  .get(
    '/outbound/:irn',
    async ({ params, auth, outboundRepo }) => {
      try {
        const result = await outboundRepo.findByIrnWithWebhookEvents(params.irn);

        if (!result) {
          return { success: false, error: 'Invoice not found', statusCode: 404 };
        }

        const { invoice, webhookEvents } = result;

        if (invoice.tenantId !== auth!.tenantId && !auth!.isAdmin) {
          return { success: false, error: 'Not authorized to view this invoice', statusCode: 403 };
        }

        // Fetch all Agenda jobs referenced across all webhook events
        const allJobIds = webhookEvents.flatMap((ev: any) => ev.jobIds ?? []);
        const agendaJobsById = new Map<string, any>();
        if (allJobIds.length > 0) {
          try {
            const { jobs } = await agenda.db.queryJobs({ ids: allJobIds });
            for (const job of jobs) {
              const id = job._id?.toString();
              if (id) agendaJobsById.set(id, job);
            }
          } catch (e: any) {
            logger.warn('Failed to fetch agenda jobs for invoice detail', { error: e.message });
          }
        }

        // Build a sorted job-steps list for a given event's jobIds
        function buildJobSteps(jobIds: string[]) {
          return (jobIds ?? [])
            .map((id: string) => {
              const job = agendaJobsById.get(id);
              if (!job) return null;
              const data = (job.data ?? {}) as any;
              const action = data.actions?.[data.stepIndex] ?? job.name;
              return {
                agendaJobId: id,
                jobName: job.name,
                action,
                stepIndex: data.stepIndex ?? null,
                jobChainId: data.jobChainId ?? null,
                status: job.state,
                scheduledAt: job.nextRunAt ?? null,
                startedAt: job.lastRunAt ?? null,
                finishedAt: job.lastFinishedAt ?? null,
                failedAt: job.failedAt ?? null,
                failReason: job.failReason ?? null,
                output: data.context ?? null,
              };
            })
            .filter(Boolean)
            .sort((a: any, b: any) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
        }

        // Build status timeline from webhook events + their job errors
        const statusHistory = webhookEvents.flatMap((ev: any) => {
          const entries: any[] = [
            {
              step: 'webhook_received',
              status: ev.status,
              eventId: ev.eventId,
              eventType: ev.eventType,
              at: ev.createdAt,
              error: null,
            },
          ];
          (ev.jobErrors ?? []).forEach((je: any) => {
            entries.push({
              step: je.action,
              status: 'failed',
              eventId: ev.eventId,
              jobChainId: je.jobChainId,
              agendaJobId: je.agendaJobId ?? null,
              at: je.failedAt,
              error: je.error,
            });
          });
          return entries;
        });

        return {
          success: true,
          data: {
            invoice: {
              irn: invoice.irn,
              erpInvoiceId: invoice.erpInvoiceId,
              source: invoice.source,
              tenantId: invoice.tenantId,
              status: invoice.status,
              paymentStatus: invoice.paymentStatus,
              paymentDetails: invoice.paymentDetails,
              workflowState: invoice.workflowState,
              lastJobError: invoice.lastJobError,
              qrCode: invoice.qrCode,
              erpSystem: invoice.erpSystem,
              validationAttempts: invoice.validationAttempts,
              validationErrors: invoice.validationErrors,
              metadata: invoice.metadata,
              createdAt: invoice.createdAt,
              updatedAt: invoice.updatedAt,
            },
            webhookEvents: webhookEvents.map((ev: any) => ({
              eventId: ev.eventId,
              eventType: ev.eventType,
              status: ev.status,
              payload: ev.payload,
              jobErrors: ev.jobErrors ?? [],
              jobSteps: buildJobSteps(ev.jobIds ?? []),
              routing: ev.metadata?.matchedRoutes,
              receivedAt: ev.createdAt,
              deliveredAt: ev.deliveredAt,
              failedAt: ev.failedAt,
              failureReason: ev.failureReason,
            })),
            statusHistory,
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
      params: t.Object({ irn: t.String() }),
      detail: {
        tags: ['Transaction Logs'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Get Outbound Invoice',
        description: 'Get outbound invoice with populated webhook events, job error timeline, and payment status',
      },
    }
  )

  /**
   * PATCH /workflow/invoices/outbound/:irn/payment-status
   * Update payment status and optionally trigger report_vat job
   */
  .patch(
    '/outbound/:irn/payment-status',
    async ({ params, body, auth, outboundRepo, webhookEventRepo }) => {
      try {
        const invoice = await outboundRepo.findByIrn(params.irn);
        if (!invoice) return { success: false, error: 'Invoice not found', statusCode: 404 };
        if (invoice.tenantId !== auth!.tenantId && !auth!.isAdmin) {
          return { success: false, error: 'Not authorized', statusCode: 403 };
        }

        const updated = await outboundRepo.updatePaymentStatus(
          params.irn,
          body.paymentStatus as OutboundPaymentStatus,
          body.paymentDetails as IOutboundPaymentDetails
        );

        // Schedule report_vat when invoice is DELIVERED and now PAID
        let jobChainId: string | undefined;
        if (
          body.paymentStatus === OutboundPaymentStatus.PAID &&
          invoice.status === OutboundInvoiceStatus.DELIVERED
        ) {
          // Create a synthetic webhook event to anchor the job chain
          const eventId = `wh_pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          await webhookEventRepo.create({
            tenantId: invoice.tenantId,
            eventId,
            eventType: 'invoice.payment.updated',
            payload: { irn: params.irn, ...body },
            resourceId: params.irn,
            resourceType: 'invoice',
            webhookUrl: '',
            maxRetries: 0,
            jobErrors: [],
            metadata: { source: 'payment_status_update' },
          } as any);

          await outboundRepo.addWebhookEvent(params.irn, eventId);

          jobChainId = await scheduleJobChain({
            webhookEventId: eventId,
            tenantId: invoice.tenantId,
            eventType: 'invoice.payment.updated',
            payload: { irn: params.irn, vatReportData: { payment_status: body.paymentStatus, reference: body.paymentDetails?.transactionReference, ...body.paymentDetails } },
            actions: ['report_vat'],
            irn: params.irn,
          });
        }

        return {
          success: true,
          message: 'Payment status updated',
          data: {
            irn: updated.irn,
            paymentStatus: updated.paymentStatus,
            paymentDetails: updated.paymentDetails,
            vatReportScheduled: !!jobChainId,
            jobChainId: jobChainId ?? null,
          },
        };
      } catch (error: any) {
        logger.error('Failed to update payment status', { error: error.message });
        return { success: false, error: error.message || 'Failed to update payment status', statusCode: error.statusCode || 500 };
      }
    },
    {
      params: t.Object({ irn: t.String() }),
      body: t.Object({
        paymentStatus: t.Union([
          t.Literal('PAID'), t.Literal('PARTIAL'), t.Literal('OVERDUE'),
        ]),
        paymentDetails: t.Optional(t.Object({
          paymentDate: t.Optional(t.String()),
          paymentMethod: t.Optional(t.String()),
          transactionReference: t.Optional(t.String()),
          amountPaid: t.Optional(t.Number()),
        })),
      }),
      detail: {
        tags: ['Transaction Logs'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Update Payment Status',
        description: 'Update outbound invoice payment status. Automatically schedules report_vat when status is PAID and invoice is DELIVERED.',
      },
    }
  )

  /**
   * POST /workflow/invoices/outbound/:irn/retry-from-step
   * Resume a failed job chain starting from a specific action
   */
  .post(
    '/outbound/:irn/retry-from-step',
    async ({ params, body, auth, outboundRepo, webhookEventRepo }) => {
      try {
        const invoice = await outboundRepo.findByIrn(params.irn);
        if (!invoice) return { success: false, error: 'Invoice not found', statusCode: 404 };
        if (invoice.tenantId !== auth!.tenantId && !auth!.isAdmin) {
          return { success: false, error: 'Not authorized', statusCode: 403 };
        }
        // Allow all retries, so we can handle duplicated events internally
        /*         if ([ OutboundInvoiceStatus.FAILED, OutboundInvoiceStatus.CREATED, ].includes(invoice.status)) {
                  return { success: false, error: 'Only FAILED invoices can be retried', statusCode: 400 };
                }
         */
        const startAction = body.fromStep;
        if (!ACTION_TO_JOB[startAction]) {
          return { success: false, error: `Unknown action: ${startAction}`, statusCode: 400 };
        }

        // ── Recover original action chain from the invoice's existing webhook events ──
        let originalActions: string[] | null = null;
        let originalWebhookUrl = '';
        const existingEventIds: string[] = invoice.webhookEvents ?? [];

        if (existingEventIds.length > 0) {
          // Find the earliest non-retry event (the original trigger for this invoice)
          const priorEvents = await webhookEventRepo.find(
            { eventId: { $in: existingEventIds }, 'metadata.source': { $ne: 'manual_retry' } },
            0,
            100
          );
          const originalEvent = priorEvents
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];

          if (originalEvent) {
            originalWebhookUrl = originalEvent.webhookUrl ?? '';

            // Tier 1: matchedRoutes stored in metadata (webhook-triggered flows)
            const matchedRoutes: any[] = (originalEvent as any).metadata?.matchedRoutes ?? [];
            const fromRoutes = matchedRoutes.flatMap((r: any) => r.actions ?? []);
            if (fromRoutes.length > 0) {
              originalActions = fromRoutes;
            } else if (originalEvent.jobIds?.length) {
              // Tier 2: read the first Agenda job's data.actions
              const { jobs } = await agenda.db.queryJobs({ ids: [originalEvent.jobIds[0]] });
              const jobActions: string[] | undefined = (jobs[0] as any)?.data?.actions;
              if (jobActions?.length) originalActions = jobActions;
            }
          }
        }

        // ── Build the retry action list from the recovered chain ──────────────────
        let actions: string[];
        if (originalActions?.length) {
          const startIndex = originalActions.indexOf(startAction);
          // If step is in the original chain, resume from there; otherwise run just that step
          actions = startIndex >= 0 ? originalActions.slice(startIndex) : [startAction];
        } else {
          // No history recoverable — fall back to the canonical outbound chain order
          const fallbackChain = [
            'generate_irn',
            'transform',
            'validate',
            'sign',
            'transmit',
            'confirm_invoice_status',
            'complete_outbound',
            'report_vat',
            'sync_erp',
          ];
          const startIndex = fallbackChain.indexOf(startAction);
          actions = startIndex >= 0 ? fallbackChain.slice(startIndex) : [startAction];
        }

        // Create a retry webhook event to anchor the new chain
        const eventId = `wh_retry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await webhookEventRepo.create({
          tenantId: invoice.tenantId,
          eventId,
          eventType: 'invoice.retry',
          payload: { irn: params.irn, fromStep: startAction },
          resourceId: params.irn,
          resourceType: 'invoice',
          webhookUrl: originalWebhookUrl,
          maxRetries: 0,
          jobErrors: [],
          metadata: { source: 'manual_retry', fromStep: startAction },
        } as any);

        await outboundRepo.addWebhookEvent(params.irn, eventId);

        // Reset invoice status so it can progress again
        await outboundRepo.updateStatus(params.irn, OutboundInvoiceStatus.CREATED);

        const jobChainId = await scheduleJobChain({
          webhookEventId: eventId,
          tenantId: invoice.tenantId,
          eventType: 'invoice.retry',
          payload: invoice.metadata,
          actions,
          irn: params.irn,
          erpInvoiceId: invoice.erpInvoiceId,
        });

        return {
          success: true,
          message: `Retry scheduled from step: ${startAction}`,
          data: { irn: params.irn, fromStep: startAction, actions, jobChainId },
        };
      } catch (error: any) {
        logger.error('Failed to retry invoice', { error: error.message });
        return { success: false, error: error.message || 'Failed to retry invoice', statusCode: error.statusCode || 500 };
      }
    },
    {
      params: t.Object({ irn: t.String() }),
      body: t.Object({
        fromStep: t.String({
          description: 'Action name to resume from (e.g. "validate", "sign", "transmit")',
        }),
      }),
      detail: {
        tags: ['Transaction Logs'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Retry Invoice From Step',
        description: 'Resume a failed invoice job chain from a specific workflow step.',
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
        const result = await outboundService.handleOutboundWorkflow(invoice.metadata as any, true);

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
