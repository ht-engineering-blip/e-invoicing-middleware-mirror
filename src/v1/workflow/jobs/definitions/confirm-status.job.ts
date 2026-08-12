import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import { InvoiceWorkflowService } from '../../../invoicing/services';

const invoiceService = new InvoiceWorkflowService();

export function registerConfirmStatusJob(): void {
  agenda.define(
    'workflow:confirm-status',
    async (job: Job<JobChainData>) => {
      const { tenantId, authContext, context, jobChainId } = job.attrs.data;

      logger.info('[Job:confirm-status] Starting', { jobChainId, tenantId });

      try {
        if (!context.irn) {
          throw new Error('IRN is required for confirm_invoice_status step');
        }

        const result = await invoiceService.confirmInvoiceStatus(
          authContext.businessId || tenantId,
          context.irn
        );

        logger.info('[Job:confirm-status] Done', {
          jobChainId,
          irn: context.irn,
          found: result.found,
        });

        await chainNext(job, { statusCheckResult: result });
      } catch (err: any) {
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
