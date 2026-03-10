import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import type { JobChainData } from '../types';
import { InvoiceWorkflowService } from '../../../invoicing/services';

const invoiceService = new InvoiceWorkflowService();

export function registerSignJob(): void {
  agenda.define(
    'workflow:sign',
    async (job: Job<JobChainData>) => {
      const { tenantId, authContext, context, jobChainId } = job.attrs.data;

      logger.info('[Job:sign] Starting', { jobChainId, tenantId });

      try {
        const invoice = context.transformedInvoice ?? context.originalPayload;
        const result = await invoiceService.signInvoice(authContext as any, invoice);

        if (!result.signed) {
          throw new Error(
            `Signing failed: ${(result.errors ?? []).join('; ')}`
          );
        }

        logger.info('[Job:sign] Signed', { jobChainId });

        await chainNext(job, { signedInvoice: result.data });
      } catch (err: any) {
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
