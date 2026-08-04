import { Elysia } from "elysia";
import { requireAuth } from "../../../middlewares/auth";
import { logger } from "../../../@lib";
import { agenda } from "../../../@lib/queue/agenda";
import { OutboundInvoiceRepository } from "../repos/outbound-invoice.repo";
import { InboundInvoiceRepository } from "../repos/inbound-invoice.repo";
import { AuditLogRepository } from "../../audit/repos/audit-log.repo";
import { WebhookEventRepository } from "../../webhook/repos/webhook-event.repo";
import { OutboundWorkflowService } from "../services/workflows/outbound.service";
import {
  IOutboundPaymentDetails,
  OutboundInvoiceStatus,
  OutboundPaymentStatus,
} from "../models/outbound-invoice.model";
import { scheduleJobChain } from "../jobs/orchestrator";
import { ACTION_TO_JOB } from "../jobs/types";
import {
  listOutboundInvoicesValidation,
  getOutboundInvoiceValidation,
  updatePaymentStatusValidation,
  retryInvoiceFromStepValidation,
  resendFailedInvoiceValidation,
  listInboundInvoicesValidation,
  getInboundInvoiceValidation,
  listAllInvoicesValidation,
} from "../validations/transaction-logs.validation";
import { TenantRepository } from "../../tenants/repos/tenant.repo";
import { decryptSensitiveData } from "../../../@lib/crypto";

/**
 * Normalizes outbound, inbound, or future invoice documents into a clean, unified schema.
 */
function normalizeInvoiceDocument(
  doc: any,
  direction: "OUTBOUND" | "INBOUND" | string,
): any {
  const supplierParty = doc.accounting_supplier_party ?? {};
  const customerParty = doc.accounting_customer_party ?? {};
  const monetaryTotal = doc.legal_monetary_total ?? {};

  return {
    id: String(doc._id ?? doc.id ?? ""),
    direction: direction.toUpperCase(),
    type: direction.toLowerCase(),
    irn: doc.irn ?? "",
    invoiceNumber: doc.invoiceNumber ?? "",
    invoiceTypeCode: doc.invoiceTypeCode ?? "",
    issueDate: doc.issueDate ?? "",
    dueDate: doc.dueDate ?? "",
    status: doc.status ?? "PENDING",
    paymentStatus: doc.payment?.paymentStatus ?? doc.paymentStatus ?? "PENDING",
    supplier: {
      name: doc.supplierName ?? supplierParty.party_name ?? "",
      tin: doc.supplierTIN ?? supplierParty.tin ?? "",
      email: doc.supplierEmail ?? supplierParty.email ?? "",
    },
    customer: {
      name: doc.customerName ?? customerParty.party_name ?? "",
      tin: doc.customerTIN ?? customerParty.tin ?? "",
      email: doc.customerEmail ?? customerParty.email ?? "",
    },
    totalAmount: monetaryTotal.payable_amount ?? doc.totalAmount ?? 0,
    currency: doc.document_currency_code ?? doc.currency ?? "NGN",
    createdAt: doc.createdAt ?? doc.issueDate,
    updatedAt: doc.updatedAt ?? doc.issueDate,
    raw: doc,
  };
}

/**
 * Transaction Logs & Invoices Routes
 */
export const transactionLogsRoutes = new Elysia({ prefix: "/invoices" })
  .use(requireAuth)
  .decorate("outboundRepo", new OutboundInvoiceRepository())
  .decorate("inboundRepo", new InboundInvoiceRepository())
  .decorate("auditRepo", new AuditLogRepository())
  .decorate("webhookEventRepo", new WebhookEventRepository())
  .decorate("outboundService", new OutboundWorkflowService())
  .decorate("tenantRepo", new TenantRepository())

  // ==================== UNIFIED INVOICES (INBOUND + OUTBOUND + FUTURE TYPES) ====================

  /**
   * GET /workflow/invoices
   * List a unified, paginated stream of inbound, outbound, transfer, and future invoice types.
   */
  .get(
    "/",
    async ({ query, auth, outboundRepo, inboundRepo, set }) => {
      try {
        const page = parseInt(query.page || "1");
        const limit = Math.min(parseInt(query.limit || "20"), 100);
        const offset = (page - 1) * limit;

        const requestedType = (
          query.type ||
          query.direction ||
          "all"
        ).toLowerCase();
        const statusFilter = query.status;
        const paymentStatusFilter = query.paymentStatus;
        const searchTerm = query.search;
        const fromDate = query.from;
        const toDate = query.to;

        // Build base filters
        const baseFilter: any = {};
        if (!auth?.isAdmin) {
          baseFilter.tenantId = auth!.tenantId;
          if (auth!.businessId) {
            baseFilter.businessId = auth!.businessId;
          }
        }
        if (statusFilter) {
          baseFilter.status = statusFilter;
        }
        if (paymentStatusFilter) {
          baseFilter.paymentStatus = paymentStatusFilter;
        }

        if (searchTerm) {
          baseFilter.search = searchTerm;
        }

        if (fromDate || toDate) {
          baseFilter.issueDate = {};
          if (fromDate) baseFilter.issueDate._gte = fromDate;
          if (toDate) baseFilter.issueDate._lte = toDate;
        }

        const countsByType: Record<string, number> = {
          outbound: 0,
          inbound: 0,
        };

        const fetchOutbound =
          requestedType === "all" || requestedType === "outbound";
        const fetchInbound =
          requestedType === "all" || requestedType === "inbound";

        const tasks: Promise<any>[] = [];

        if (fetchOutbound) {
          tasks.push(
            (async () => {
              const where: any = { ...baseFilter };
              if (where.tenantId) where.tenantId = { _eq: where.tenantId };
              if (where.businessId) {
                where.businessId = { _eq: where.businessId };
              }
              if (where.status) where.status = { _eq: where.status };
              if (where.paymentStatus) {
                where.paymentStatus = { _eq: where.paymentStatus };
              }

              const docs = await outboundRepo.findMany(
                where,
                undefined,
                1000,
                0,
              );
              const formatted = docs.map((doc: any) =>
                normalizeInvoiceDocument(doc, "OUTBOUND"),
              );

              countsByType.outbound = formatted.length;
              return formatted;
            })(),
          );
        }

        if (fetchInbound) {
          tasks.push(
            (async () => {
              const where: any = { ...baseFilter };
              if (where.tenantId) where.tenantId = { _eq: where.tenantId };
              if (where.businessId) {
                where.businessId = { _eq: where.businessId };
              }
              if (where.status) where.status = { _eq: where.status };
              if (where.paymentStatus) {
                where.paymentStatus = { _eq: where.paymentStatus };
              }

              const docs = await inboundRepo.findMany(
                where,
                undefined,
                1000,
                0,
              );
              const formatted = docs.map((doc: any) =>
                normalizeInvoiceDocument(doc, "INBOUND"),
              );

              countsByType.inbound = formatted.length;
              return formatted;
            })(),
          );
        }

        const results = await Promise.all(tasks);
        const combinedInvoices = results.flat();

        combinedInvoices.sort((a, b) => {
          const dateA = new Date(a.createdAt || a.issueDate).getTime();
          const dateB = new Date(b.createdAt || b.issueDate).getTime();
          return dateB - dateA;
        });

        const totalCount = combinedInvoices.length;
        const paginatedData = combinedInvoices.slice(offset, offset + limit);

        return {
          success: true,
          data: paginatedData,
          meta: {
            total: totalCount,
            page,
            limit,
            pages: Math.ceil(totalCount / limit) || 1,
            countsByType,
          },
        };
      } catch (error: any) {
        logger.error("Failed to list unified invoices stream", {
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to retrieve unified invoice stream",
          statusCode: 500,
        };
      }
    },
    listAllInvoicesValidation,
  )

  // ==================== OUTBOUND INVOICES ====================

  /**
   * GET /workflow/invoices/outbound
   * List outbound invoices with filtering and pagination
   */
  .get(
    "/outbound",
    async ({ query, auth, outboundRepo, set }) => {
      try {
        const page = parseInt(query.page || "1");
        const limit = Math.min(parseInt(query.limit || "20"), 100);
        const offset = (page - 1) * limit;

        // Build filters
        const filters: any = {};
        if (!auth?.isAdmin) {
          filters.tenantId = { _eq: auth!.tenantId };
        }

        if (query.status) filters.status = { _eq: query.status };
        if (query.source) filters.source = { _eq: query.source };
        if (query.erpInvoiceId)
          filters.erpInvoiceId = { _eq: query.erpInvoiceId };

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
            invoiceNumber:
              inv.metadata?.invoiceNumber || inv.metadata?.InvoiceNumber,
            status: inv.status,
            paymentStatus: inv.paymentStatus,
            qrCode: inv.qrCode,
            erp: inv.erpSystem,
            workflowState: inv.workflowState,
            lastJobError: inv.lastJobError,
            customerName:
              inv.metadata?.AccountingCustomerParty?.Party?.PartyName?.[0]
                ?.Name,
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
        set.status = 500;
        logger.error("Failed to list outbound invoices", {
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Failed to list outbound invoices",
          statusCode: error.statusCode || 500,
        };
      }
    },
    listOutboundInvoicesValidation,
  )

  /**
   * GET /workflow/invoices/outbound/:irn
   * Get outbound invoice with status history
   */
  .get(
    "/outbound/:irn",
    async ({ params, auth, outboundRepo, set }) => {
      try {
        const tenantId = auth!.isAdmin ? undefined : auth!.tenantId;
        const result = await outboundRepo.findByIrnWithWebhookEvents(
          params.irn,
          tenantId,
        );

        console.log({ result });

        if (!result) {
          set.status = 404;
          return {
            success: false,
            error: "Invoice not found",
            statusCode: 404,
          };
        }

        const { invoice, webhookEvents } = result;

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
            logger.warn("Failed to fetch agenda jobs for invoice detail", {
              error: e.message,
            });
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
              step: "webhook_received",
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
              status: "failed",
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
        set.status = 500;
        logger.error("Failed to get outbound invoice", {
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Failed to get outbound invoice",
          statusCode: error.statusCode || 500,
        };
      }
    },
    getOutboundInvoiceValidation,
  )

  /**
   * PATCH /workflow/invoices/outbound/:irn/payment-status
   * Update payment status and optionally trigger report_vat job
   */
  .patch(
    "/outbound/:irn/payment-status",
    async ({ params, body, auth, outboundRepo, webhookEventRepo, set }) => {
      try {
        const tenantId = auth!.isAdmin ? undefined : auth!.tenantId;
        const invoice = await outboundRepo.findByIrn(params.irn, tenantId);
        if (!invoice) {
          set.status = 404;
          return {
            success: false,
            error: "Invoice not found",
            statusCode: 404,
          };
        }

        const updated = await outboundRepo.updatePaymentStatus(
          params.irn,
          body.paymentStatus as OutboundPaymentStatus,
          body.paymentDetails as IOutboundPaymentDetails,
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
            eventType: "invoice.payment.updated",
            payload: { irn: params.irn, ...body },
            resourceId: params.irn,
            resourceType: "invoice",
            webhookUrl: "",
            maxRetries: 0,
            jobErrors: [],
            metadata: { source: "payment_status_update" },
          } as any);

          await outboundRepo.addWebhookEvent(params.irn, eventId);

          jobChainId = await scheduleJobChain({
            webhookEventId: eventId,
            tenantId: invoice.tenantId,
            eventType: "invoice.payment.updated",
            payload: {
              irn: params.irn,
              vatReportData: {
                payment_status: body.paymentStatus,
                reference: body.paymentDetails?.transactionReference,
                ...body.paymentDetails,
              },
            },
            actions: ["report_vat"],
            irn: params.irn,
          });
        }

        return {
          success: true,
          message: "Payment status updated",
          data: {
            irn: updated.irn,
            paymentStatus: updated.paymentStatus,
            paymentDetails: updated.paymentDetails,
            vatReportScheduled: !!jobChainId,
            jobChainId: jobChainId ?? null,
          },
        };
      } catch (error: any) {
        logger.error("Failed to update payment status", {
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Failed to update payment status",
          statusCode: error.statusCode || 500,
        };
      }
    },
    updatePaymentStatusValidation,
  )

  /**
   * POST /workflow/invoices/outbound/:irn/retry-from-step
   * Resume a failed job chain starting from a specific action
   */
  .post(
    "/outbound/:irn/retry-from-step",
    async ({ params, body, auth, outboundRepo, webhookEventRepo, set }) => {
      try {
        const tenantId = auth!.isAdmin ? undefined : auth!.tenantId;
        const invoice = await outboundRepo.findByIrn(params.irn, tenantId);
        if (!invoice)
          return {
            success: false,
            error: "Invoice not found",
            statusCode: 404,
          };

        // Allow all retries, so we can handle duplicated events internally
        /*         if ([ OutboundInvoiceStatus.FAILED, OutboundInvoiceStatus.CREATED, ].includes(invoice.status)) {
                  return { success: false, error: 'Only FAILED invoices can be retried', statusCode: 400 };
                }
         */
        const startAction = body.fromStep;
        if (!ACTION_TO_JOB[startAction]) {
          set.status = 400;
          return {
            success: false,
            error: `Unknown action: ${startAction}`,
            statusCode: 400,
          };
        }

        // ── Recover original action chain from the invoice's existing webhook events ──
        let originalActions: string[] | null = null;
        let originalWebhookUrl = "";
        const existingEventIds: string[] = invoice.webhookEvents ?? [];

        if (existingEventIds.length > 0) {
          // Find the earliest non-retry event (the original trigger for this invoice)
          const eventFilter: any = {
            eventId: { $in: existingEventIds },
            "metadata.source": { $ne: "manual_retry" },
          };
          if (tenantId) eventFilter.tenantId = tenantId;
          const priorEvents = await webhookEventRepo.find(eventFilter, 0, 100);
          const originalEvent = priorEvents.sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          )[0];

          if (originalEvent) {
            originalWebhookUrl = originalEvent.webhookUrl ?? "";

            // Tier 1: matchedRoutes stored in metadata (webhook-triggered flows)
            const matchedRoutes: any[] =
              (originalEvent as any).metadata?.matchedRoutes ?? [];
            const fromRoutes = matchedRoutes.flatMap(
              (r: any) => r.actions ?? [],
            );
            if (fromRoutes.length > 0) {
              originalActions = fromRoutes;
            } else if (originalEvent.jobIds?.length) {
              // Tier 2: read the first Agenda job's data.actions
              const { jobs } = await agenda.db.queryJobs({
                ids: [originalEvent.jobIds[0]],
              });
              const jobActions: string[] | undefined = (jobs[0] as any)?.data
                ?.actions;
              if (jobActions?.length) originalActions = jobActions;
            }
          }
        }

        // ── Build the retry action list from the recovered chain ──────────────────
        let actions: string[];
        if (originalActions?.length) {
          const startIndex = originalActions.indexOf(startAction);
          // If step is in the original chain, resume from there; otherwise run just that step
          actions =
            startIndex >= 0 ? originalActions.slice(startIndex) : [startAction];
        } else {
          // No history recoverable — fall back to the canonical outbound chain order
          const fallbackChain = [
            "generate_irn",
            "transform",
            "validate",
            "sign",
            "transmit",
            "confirm_invoice_status",
            "complete_outbound",
            "report_vat",
            "sync_erp",
          ];
          const startIndex = fallbackChain.indexOf(startAction);
          actions =
            startIndex >= 0 ? fallbackChain.slice(startIndex) : [startAction];
        }

        // Create a retry webhook event to anchor the new chain
        const eventId = `wh_retry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await webhookEventRepo.create({
          tenantId: invoice.tenantId,
          eventId,
          eventType: "invoice.retry",
          payload: { irn: params.irn, fromStep: startAction },
          resourceId: params.irn,
          resourceType: "invoice",
          webhookUrl: originalWebhookUrl,
          maxRetries: 0,
          jobErrors: [],
          metadata: { source: "manual_retry", fromStep: startAction },
        } as any);

        await outboundRepo.addWebhookEvent(params.irn, eventId);

        // Reset invoice status so it can progress again
        await outboundRepo.updateStatus(
          params.irn,
          OutboundInvoiceStatus.CREATED,
        );

        const jobChainId = await scheduleJobChain({
          webhookEventId: eventId,
          tenantId: invoice.tenantId,
          eventType: "invoice.retry",
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
        set.status = 500;
        logger.error("Failed to retry invoice", { error: error.message });
        return {
          success: false,
          error: error.message || "Failed to retry invoice",
          statusCode: error.statusCode || 500,
        };
      }
    },
    retryInvoiceFromStepValidation,
  )

  /**
   * POST /workflow/invoices/outbound/:irn/resend
   * Resend failed invoice workflow
   */
  .post(
    "/outbound/:irn/resend",
    async ({
      params,
      auth,
      outboundRepo,
      outboundService,
      tenantRepo,
      set,
    }) => {
      try {
        // Find invoice
        const tenantId = auth!.isAdmin ? undefined : auth!.tenantId;
        const invoice = await outboundRepo.findByIrn(params.irn, tenantId);

        if (!invoice) {
          set.status = 404;
          return {
            success: false,
            error: "Invoice not found",
            statusCode: 404,
          };
        }

        // Check if invoice is in failed state
        if (invoice.status !== OutboundInvoiceStatus.FAILED) {
          set.status = 400;
          return {
            success: false,
            error: "Only failed invoices can be resent",
            statusCode: 400,
          };
        }

        // Determine the failure point and restart from there
        const workflowState = invoice.workflowState;
        let restartFrom = "validate";

        if (!workflowState?.validated) {
          restartFrom = "validate";
        } else if (!workflowState?.signed) {
          restartFrom = "sign";
        } else if (!workflowState?.transmitted) {
          restartFrom = "transmit";
        }

        // Update status to allow retry
        await outboundRepo.updateStatus(
          params.irn,
          OutboundInvoiceStatus.VALIDATED,
        );

        let business_id = auth!.businessId;

        if (auth.isAdmin) {
          const tenant = await tenantRepo.findByTenantId(invoice.tenantId);
          if (tenant?.config?.firsCredentials?.clientId) {
            business_id = decryptSensitiveData(
              tenant.config.firsCredentials.clientId,
            );
          }
        }

        // Trigger workflow
        const data = {
          irn: params.irn,
          tenant_id: auth!.tenantId || invoice.tenantId,
          business_id: business_id!,
        };

        const result = await outboundService.handleOutboundWorkflow(data, true);

        return {
          success: true,
          message: "Invoice workflow restarted",
          data: {
            irn: params.irn,
            restartedFrom: restartFrom,
            result: result,
          },
        };
      } catch (error: any) {
        set.status = 500;
        logger.error("Failed to resend invoice", { error: error.message });
        return {
          success: false,
          error: error.message || "Failed to resend invoice",
          statusCode: error.statusCode || 500,
        };
      }
    },
    resendFailedInvoiceValidation,
  )

  // ==================== INBOUND INVOICES ====================

  /**
   * GET /workflow/invoices/inbound
   * List inbound invoices with filtering and pagination
   */
  .get(
    "/inbound",
    async ({ query, auth, inboundRepo, set }) => {
      try {
        const page = parseInt(query.page || "1");
        const limit = Math.min(parseInt(query.limit || "20"), 100);
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
        set.status = 500;
        logger.error("Failed to list inbound invoices", {
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Failed to list inbound invoices",
          statusCode: error.statusCode || 500,
        };
      }
    },
    listInboundInvoicesValidation,
  )

  /**
   * GET /workflow/invoices/inbound/:irn
   * Get inbound invoice with status history
   */
  .get(
    "/inbound/:irn",
    async ({ params, auth, inboundRepo, auditRepo, set }) => {
      try {
        // Find invoice
        const tenantId = auth!.isAdmin ? undefined : auth!.tenantId;
        const businessId = auth!.isAdmin ? undefined : auth!.businessId;
        const invoice = await inboundRepo.findByIRN(
          params.irn,
          tenantId,
          businessId,
        );

        if (!invoice) {
          set.status = 404;
          return {
            success: false,
            error: "Invoice not found",
            statusCode: 404,
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
        set.status = 500;
        logger.error("Failed to get inbound invoice", { error: error.message });
        return {
          success: false,
          error: error.message || "Failed to get inbound invoice",
          statusCode: error.statusCode || 500,
        };
      }
    },
    getInboundInvoiceValidation,
  );
