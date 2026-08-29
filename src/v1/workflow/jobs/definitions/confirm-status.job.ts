import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, formatJobError } from "../chain";
import { InvoiceWorkflowService } from "../../../invoicing/services";
import { WebhookEventRepository } from "../../../webhook/repos/webhook-event.repo";

const invoiceService = new InvoiceWorkflowService();
const webhookEventRepo = new WebhookEventRepository();

export function registerConfirmStatusJob(): void {
  agenda.define("workflow:confirm-status", async (job: Job<JobChainData>) => {
    const {
      tenantId,
      authContext,
      context,
      jobChainId,
      webhookEventId,
      stepIndex,
    } = job.attrs.data;

    logger.info("[Job:confirm-status] Starting", { jobChainId, tenantId });

    try {
      if (!context.irn) {
        throw new Error("IRN is required for confirm_invoice_status step");
      }

      const result = await invoiceService.confirmInvoiceStatus(
        authContext.businessId || tenantId,
        context.irn,
      );

      logger.info("[Job:confirm-status] Done", {
        jobChainId,
        irn: context.irn,
        found: result.found,
      });

      await chainNext(job, { statusCheckResult: result });
    } catch (err: any) {
      const errorMessage = formatJobError(err);
      logger.warn(
        "[Job:confirm-status] Status check failed (tolerated — moving to next step)",
        {
          jobChainId,
          irn: context.irn,
          error: errorMessage,
        },
      );

      if (webhookEventId) {
        try {
          await webhookEventRepo.appendJobError(webhookEventId, {
            step: stepIndex,
            action: "confirm_invoice_status",
            jobChainId,
            agendaJobId: job.attrs._id?.toString(),
            error: errorMessage,
            failedAt: new Date(),
          });
        } catch (logErr: any) {
          logger.warn(
            "[Job:confirm-status] Could not append job error to webhook event",
            {
              webhookEventId,
              error: logErr.message,
            },
          );
        }
      }

      await chainNext(job, {
        confirmStatusFailed: true,
        statusCheckResult: null,
      });
    }
  });
}
