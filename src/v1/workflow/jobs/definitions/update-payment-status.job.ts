import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import { FIRSService } from '../../../../@lib/adapters/firs/firs.service';


async function getOutboundRepo() {
  const { OutboundInvoiceRepository } = await import('../../repos/outbound-invoice.repo');
  return new OutboundInvoiceRepository();
}

async function getFirsService() {
  return new FIRSService();
}

export function registerUpdatePaymentStatusJob(): void {
  agenda.define(
    'workflow:update-payment-status',
    async (job: Job<JobChainData>) => {
      const { tenantId, context, jobChainId, authContext } = job.attrs.data;
      const irn = context.irn;

      logger.info('[Job:update-payment-status] Starting', { jobChainId, tenantId, irn });

      if (!irn) {
        const err = new Error('irn is required for update-payment-status job');
        await chainFail(job, err);
        throw err;
      }

      try {
        const outboundRepo = await getOutboundRepo();
        const firsService = await getFirsService();

        const vatReportData = context.vatReportData ?? context.originalPayload?.vatReportData;
        const paymentStatus = context.paymentStatus ?? context.originalPayload?.paymentStatus;
        const paymentDetails = context.paymentDetails ?? context.originalPayload?.paymentDetails;

        let vatResult = null;

        if (paymentStatus) {
          await outboundRepo.updatePaymentStatus(irn, paymentStatus, paymentDetails);
          logger.info('[Job:update-payment-status] Payment status updated in database', {
            jobChainId,
            irn,
            paymentStatus,
          });
        }

        if (vatReportData) {
          // Submit VAT post-payment report to FIRS
          vatResult = await firsService.reportInvoice(tenantId, {
            irn,
            businessId: authContext.businessId,
            ...vatReportData,
          });

          logger.info('[Job:update-payment-status] VAT report submitted', {
            jobChainId,
            irn,
            vatResult,
          });
        }

        await chainNext(job, { vatReportResult: vatResult, paymentStatusUpdated: !!paymentStatus });
      } catch (err: any) {
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
