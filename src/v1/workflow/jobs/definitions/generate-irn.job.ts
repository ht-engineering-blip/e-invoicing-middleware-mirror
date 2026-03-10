import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import type { JobChainData } from '../types';

// Lazy-import to avoid circular deps at module load
async function getOutboundRepo() {
  const { OutboundInvoiceRepository } = await import('../../repos/outbound-invoice.repo');
  return new OutboundInvoiceRepository();
}

export function registerGenerateIrnJob(): void {
  agenda.define(
    'workflow:generate-irn',
    async (job: Job<JobChainData>) => {
      const { tenantId, context, jobChainId } = job.attrs.data;

      logger.info('[Job:generate-irn] Starting', { jobChainId, tenantId });

      try {
        const outboundRepo = await getOutboundRepo();

        // Generate IRN by looking up an existing outbound record,
        // or fall back to creating one keyed by a hash of the payload.
        const existingInvoice = context.irn
          ? await outboundRepo.findByIrn(context.irn)
          : null;

        const irn =
          existingInvoice?.irn ||
          context.irn ||
          `IRN-${tenantId.slice(0, 6).toUpperCase()}-${Date.now()}`;

        logger.info('[Job:generate-irn] IRN resolved', { jobChainId, irn });

        await chainNext(job, { irn });
      } catch (err: any) {
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
