import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, formatJobError } from "../chain";
import { InvoiceWorkflowService } from "../../../invoicing/services";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { OutboundInvoiceStatus } from "../../models";
import { WebhookEventRepository } from "../../../webhook/repos/webhook-event.repo";

const invoiceService = new InvoiceWorkflowService();
const webhookEventRepo = new WebhookEventRepository();

export function registerSignJob(): void {
  agenda.define("workflow:sign", async (job: Job<JobChainData>) => {
    const {
      tenantId,
      authContext,
      context,
      jobChainId,
      webhookEventId,
      stepIndex,
    } = job.attrs.data;

    logger.info("[Job:sign] Starting", { jobChainId, tenantId });

    try {
      const invoice = context.transformedInvoice ?? context.originalPayload;
      const result = await invoiceService.signInvoice(
        authContext as any,
        invoice,
      );

      if (!result.signed) {
        const errorDetail = Array.isArray(result.errors)
          ? result.errors.join("; ")
          : result.errors || result.message || "Signing failed";
        throw new Error(`Invoice signing failed: ${errorDetail}`);
      }

      logger.info("[Job:sign] Signed", { jobChainId });

      const irn = context.irn ?? (result.data as any)?.irn;
      if (irn) {
        const outboundRepo = new OutboundInvoiceRepository();
        await outboundRepo.update(irn, {
          status: OutboundInvoiceStatus.SIGNED,
        });
        await outboundRepo.updateWorkflowState(irn, {
          signed: true,
        });
      }

      await chainNext(job, { signedInvoice: result.data });
    } catch (err: any) {
      const errorMessage = formatJobError(err);
      logger.warn(
        "[Job:sign] Signing failed (tolerated — moving to next step)",
        {
          jobChainId,
          irn: context.irn,
          error: errorMessage,
        },
      );

      const irn = context.irn;
      if (irn) {
        try {
          const outboundRepo = new OutboundInvoiceRepository();
          await outboundRepo.setLastJobError(irn, "sign", errorMessage);
          await outboundRepo.update(irn, {
            status: OutboundInvoiceStatus.FAILED,
          });
        } catch (repoErr: any) {
          logger.warn("[Job:sign] Failed to update invoice signing error", {
            irn,
            error: repoErr.message,
          });
        }
      }

      if (webhookEventId) {
        try {
          await webhookEventRepo.appendJobError(webhookEventId, {
            step: stepIndex,
            action: "sign",
            jobChainId,
            agendaJobId: job.attrs._id?.toString(),
            error: errorMessage,
            failedAt: new Date(),
          });
        } catch (logErr: any) {
          logger.warn(
            "[Job:sign] Could not append job error to webhook event",
            {
              webhookEventId,
              error: logErr.message,
            },
          );
        }
      }

      // Do NOT halt chain. Proceed to next step
      await chainNext(job, {
        signingFailed: true,
        signingError: errorMessage,
      });
    }
  });
}
