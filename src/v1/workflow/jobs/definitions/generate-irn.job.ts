import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import { generateIRN } from '../../utils/transformer/utils';

// Lazy-import to avoid circular deps at module load
async function getOutboundRepo() {
  const { OutboundInvoiceRepository } = await import('../../repos/outbound-invoice.repo');
  return new OutboundInvoiceRepository();
}

export function registerGenerateIrnJob(): void {
  agenda.define(
    'workflow:generate-irn',
    async (job: Job<JobChainData>) => {
      const { tenantId, context, jobChainId, authContext } = job.attrs.data;

      logger.info('[Job:generate-irn] Starting', { jobChainId, tenantId });

      try {

        //Use existing IRN from context
        const existingInvoice = context.irn;
        console.log({ context })

        const invoiceRef = `INV${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

        console.log(invoiceRef,
          authContext?.serviceId,
          context?.originalPayload?.invoice?.issueDate ? new Date(context?.originalPayload?.invoice?.issueDate) : new Date(),)
        const irn = existingInvoice || generateIRN(
          invoiceRef,
          authContext?.serviceId,
          context?.originalPayload?.invoice?.issueDate ? new Date(context?.originalPayload?.invoice?.issueDate) : new Date(),
        );

        logger.info('[Job:generate-irn] IRN Generated', { jobChainId, irn });

        await chainNext(job, { irn });
      } catch (err: any) {
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
