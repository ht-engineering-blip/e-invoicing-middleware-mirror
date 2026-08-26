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

export async function processTransmitJob(
  job: Job<JobChainData>,
): Promise<void> {
  const {
    tenantId,
    authContext,
    context,
    jobChainId,
    webhookEventId,
    stepIndex,
  } = job.attrs.data;

  logger.info("[Job:transmit] Starting", { jobChainId, tenantId });

  try {
    if (!context.irn) {
      throw new Error(
        "IRN is required for transmit step — run generate_irn first",
      );
    }

    const result = await invoiceService.transmitInvoice(
      authContext as any,
      context.irn,
    );

    if (!result.transmitted) {
      const errorDetail =
        (Array.isArray(result.errors)
          ? result.errors.join("; ")
          : result.errors) ||
        result.message ||
        "Transmission failed";
      throw new Error(`Invoice transmission failed: ${errorDetail}`);
    }

    logger.info("[Job:transmit] Transmitted successfully", {
      jobChainId,
      irn: context.irn,
    });

    if (context.irn) {
      const outboundRepo = new OutboundInvoiceRepository();
      await outboundRepo.update(context.irn, {
        status: OutboundInvoiceStatus.TRANSMITTED,
      });
      await outboundRepo.updateWorkflowState(context.irn, {
        transmitted: true,
      });
    }

    await chainNext(job, { transmissionResult: result.data });
  } catch (err: any) {
    const errorMessage = formatJobError(err);
    logger.warn(
      "[Job:transmit] Transmission failed (tolerated — proceeding to next step)",
      {
        jobChainId,
        irn: context.irn,
        error: errorMessage,
      },
    );

    if (context.irn) {
      try {
        const outboundRepo = new OutboundInvoiceRepository();
        await outboundRepo.setLastJobError(
          context.irn,
          "transmit",
          errorMessage,
        );
        await outboundRepo.update(context.irn, {
          status: OutboundInvoiceStatus.TRANSMISTION_FAILED,
        });
      } catch (repoErr: any) {
        logger.warn(
          "[Job:transmit] Failed to update invoice transmission error",
          {
            irn: context.irn,
            error: repoErr.message,
          },
        );
      }
    }

    if (webhookEventId) {
      try {
        await webhookEventRepo.appendJobError(webhookEventId, {
          step: stepIndex,
          action: "transmit",
          jobChainId,
          agendaJobId: job.attrs._id?.toString(),
          error: errorMessage,
          failedAt: new Date(),
        });
      } catch (logErr: any) {
        logger.warn(
          "[Job:transmit] Could not append job error to webhook event",
          {
            webhookEventId,
            error: logErr.message,
          },
        );
      }
    }

    // Do NOT halt chain. Proceed to next step (e.g. complete_outbound)
    await chainNext(job, {
      transmissionFailed: true,
      transmissionError: errorMessage,
    });
  }
}

export function registerTransmitJob(): void {
  agenda.define("workflow:transmit", processTransmitJob);
}
