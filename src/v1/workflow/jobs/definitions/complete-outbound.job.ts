import type { Job } from 'agenda';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import type { JobChainData } from '../types';
import { OutboundWorkflowService } from '../../services';
import { TransformWorkflowService } from '../../services';
import { OutboundInvoiceRepository } from '../../repos/outbound-invoice.repo';
import { OutboundInvoiceStatus, OutboundInvoiceSource } from '../../models';
import { buildQrUrl } from '../../../../@lib';

const outboundService = new OutboundWorkflowService();
const transformService = new TransformWorkflowService();
const outboundRepo = new OutboundInvoiceRepository();

export function registerCompleteOutboundJob(): void {
  agenda.define(
    'workflow:complete-outbound',
    async (job: Job<JobChainData>) => {
      const { tenantId, authContext, context, jobChainId } = job.attrs.data;
      const businessId = authContext?.businessId ?? tenantId;

      logger.info('[Job:complete-outbound] Starting', {
        jobChainId,
        tenantId,
        mode: context.transformedInvoice ? 'finalize' : 'full-pipeline',
      });

      try {
        let irn = context.irn;
        let qrCode: string | undefined;
        let firsSignedData: any;

        if (!context.transformedInvoice) {
          // ── Full-pipeline mode ────────────────────────────────────────────────
          // Used when complete_outbound is the ONLY action (standalone invocation).
          // Runs: transform → validate + sign + confirm + QR + transmit (via handleOutboundWorkflow)

          logger.info('[Job:complete-outbound] Full-pipeline mode', { jobChainId });

          // Step 1: Transform ERP payload → FIRS format
          const transformed = await transformService.transformInvoiceV2(
            context.originalPayload,
            authContext as any,
            context.sourceType
          );

          // Step 2: Ensure IRN is on the transformed invoice
          irn = irn ?? transformed.irn;
          if (irn) transformed.irn = irn;

          // Step 3: Persist invoice record
          if (irn) {
            await outboundRepo.upsertByIrn({
              irn,
              tenantId: authContext?.tenantId,
              erpSystem: authContext?.tenantERP,
              createdBy: authContext?.tenantId,
              source: (context.source as OutboundInvoiceSource) ?? OutboundInvoiceSource.API,
              erpInvoiceId: context.erpInvoiceId,
              metadata: { transformedInvoice: transformed },
            });
            await outboundRepo.updateWorkflowState(irn, { transformed: true });
            transformed.tenant_id = tenantId
          }

          // Step 4: validate → sign (if needed) → confirm → QR → transmit
          const result = await outboundService.handleOutboundWorkflow(transformed, true);
          qrCode = result.qrCode as string;
          firsSignedData = result.data;

        } else {
          // ── Finalize mode ─────────────────────────────────────────────────────
          // Used as the LAST step in a chain where individual steps already ran.
          // Only generates QR code and marks the invoice as DELIVERED.

          logger.info('[Job:complete-outbound] Finalize mode', { jobChainId, irn });

          if (!irn) throw new Error('IRN is required for complete-outbound finalize step');

          const result = await outboundService.generateQRCode(irn, businessId);
          qrCode = result.qrCode!;
          firsSignedData = result.data;
        }

        // ── Persist final state ─────────────────────────────────────────────────
        if (irn) {
          await outboundRepo.update(irn, {
            qrCode,
            status: OutboundInvoiceStatus.DELIVERED,
            metadata: {
              ...(context.metadata ?? {}),
              firsSignedData,
            },
          });
          await outboundRepo.updateWorkflowState(irn, { delivered: true });
        }

        logger.info('[Job:complete-outbound] Done — invoice DELIVERED', { jobChainId, irn });

        await chainNext(job, { qrCode: buildQrUrl(irn, !!qrCode) as string, firsSignedData, irn });

      } catch (err: any) {
        const { tenantId, authContext, context, jobChainId } = job.attrs.data;
        await outboundRepo.update(context.irn!, { status: OutboundInvoiceStatus.FAILED });
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
