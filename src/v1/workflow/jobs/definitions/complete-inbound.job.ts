import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import type { JobChainData } from '../types';
import { InboundWorkflowService } from '../../services';

const inboundService = new InboundWorkflowService();

export function registerCompleteInboundJob(): void {
  agenda.define(
    'workflow:complete-inbound',
    async (job: Job<JobChainData>) => {
      const { tenantId, context, jobChainId } = job.attrs.data;

      logger.info('[Job:complete-inbound] Starting full inbound pipeline', { jobChainId, tenantId });

      try {
        const result = await inboundService.handleInboundWorkflow(
          context.originalPayload
        );

        if (!result.status) {
          throw new Error(result.error ?? 'Inbound workflow failed');
        }

        logger.info('[Job:complete-inbound] Done', { jobChainId });

        await chainNext(job, { inboundResult: result.data });
      } catch (err: any) {
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
