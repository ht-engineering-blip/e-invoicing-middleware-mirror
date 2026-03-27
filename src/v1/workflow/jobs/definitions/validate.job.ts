import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import type { JobChainData } from '../types';
import { InvoiceWorkflowService } from '../../../invoicing/services';

const invoiceService = new InvoiceWorkflowService();

export function registerValidateJob(): void {
  agenda.define(
    'workflow:validate',
    async (job: Job<JobChainData>) => {
      const { tenantId, authContext, context, jobChainId } = job.attrs.data;

      logger.info('[Job:validate] Starting', { jobChainId, tenantId });

      try {
        const invoice = {
          ...(context.originalPayload || {}),
          ...(context.transformedInvoice || {})
        }
        //  context.transformedInvoice ?? context.originalPayload;
        const result = await invoiceService.validateInvoice(
          authContext.businessId || tenantId,
          invoice
        );

        if (!result.valid) {
          throw new Error(
            `Error: ${(result.errors ?? []).join('; ')}`
          );
        }

        logger.info('[Job:validate] Passed', { jobChainId });

        await chainNext(job, { validationResult: result });
      } catch (err: any) {
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
