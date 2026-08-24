import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import { InvoiceWorkflowService } from '../../../invoicing/services';
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { OutboundInvoiceStatus } from "../../models";

const invoiceService = new InvoiceWorkflowService();

export async function processTransmitJob(
  job: Job<JobChainData>,
): Promise<void> {
  const { tenantId, authContext, context, jobChainId } = job.attrs.data;

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

    logger.info("[Job:transmit] Transmitted", { jobChainId, irn: context.irn });

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
    await chainFail(job, err);
    throw err;
  }
}

export function registerTransmitJob(): void {
  agenda.define("workflow:transmit", processTransmitJob);
}
