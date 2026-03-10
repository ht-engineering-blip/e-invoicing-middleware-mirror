import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import type { JobChainData } from '../types';
import { TransformWorkflowService } from '../../services';

const transformService = new TransformWorkflowService();

export function registerTransformJob(): void {
  agenda.define(
    'workflow:transform',
    async (job: Job<JobChainData>) => {
      const { tenantId, authContext, context, jobChainId } = job.attrs.data;

      logger.info('[Job:transform] Starting', { jobChainId, tenantId });

      try {
        const result = await transformService.transformInvoice(
          context.originalPayload,
          authContext as any,
          context.sourceType
        );

        logger.info('[Job:transform] Done', { jobChainId });

        await chainNext(job, { transformedInvoice: result });
      } catch (err: any) {
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
