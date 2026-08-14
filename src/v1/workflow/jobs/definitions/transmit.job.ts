import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import { InvoiceWorkflowService } from '../../../invoicing/services';

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
      throw new Error("Transmission failed");
    }

    logger.info("[Job:transmit] Transmitted", { jobChainId, irn: context.irn });

    await chainNext(job, { transmissionResult: result.data });
  } catch (err: any) {
    await chainFail(job, err);
    throw err;
  }
}

export function registerTransmitJob(): void {
  agenda.define("workflow:transmit", processTransmitJob);
}
