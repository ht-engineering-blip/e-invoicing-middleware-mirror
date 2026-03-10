import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import type { JobChainData } from '../types';
import { OutboundWorkflowService } from '../../services';

const outboundService = new OutboundWorkflowService();

export function registerCompleteOutboundJob(): void {
  agenda.define(
    'workflow:complete-outbound',
    async (job: Job<JobChainData>) => {
      const { tenantId, context, jobChainId } = job.attrs.data;

      logger.info('[Job:complete-outbound] Starting full pipeline', { jobChainId, tenantId });

      try {
        const result = await outboundService.handleOutboundWorkflow(
          context.originalPayload,
          true // transmit = true
        );

        logger.info('[Job:complete-outbound] Done', { jobChainId });

        await chainNext(job, {
          qrCode: result.qrCode,
          signedInvoice: result.data,
        });
      } catch (err: any) {
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
