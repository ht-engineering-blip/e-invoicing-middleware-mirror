import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { OutboundWorkflowService } from "../../services";
import { TransformWorkflowService } from "../../services";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { OutboundInvoiceStatus, OutboundInvoiceSource } from "../../models";

const outboundService = new OutboundWorkflowService();
const transformService = new TransformWorkflowService();
const outboundRepo = new OutboundInvoiceRepository();

export function registerCompleteOutboundJob(): void {
  agenda.define(
    "workflow:complete-outbound",
    async (job: Job<JobChainData>) => {
      const { tenantId, authContext, context, jobChainId } = job.attrs.data;

      logger.info("[Job:complete-outbound] Starting", {
        jobChainId,
        tenantId,
        hasTransformedInvoice: !!context.transformedInvoice,
      });

      try {
        let irn = context.irn;
        let qrCode: string | undefined;
        let firsSignedData: any;
        let transmissionFailed = false;
        let result: any;

        let transformed = context.transformedInvoice;
        if (!transformed && context.originalPayload) {
          logger.info("[Job:complete-outbound] Transforming invoice payload", {
            jobChainId,
            irn,
            tenantId,
          });

          transformed = await transformService.transformInvoiceV2(
            context.originalPayload,
            authContext,
            context.sourceType,
          );
        }

        // Ensure IRN is on the transformed invoice
        irn = irn ?? transformed?.irn;
        if (irn && transformed) transformed.irn = irn;

        // Persist invoice record if needed
        if (irn && transformed) {
          const source =
            (context.source as OutboundInvoiceSource) ??
            OutboundInvoiceSource.API;
          await outboundRepo.upsertByIrn({
            irn,
            tenantId: authContext?.tenantId ?? tenantId,
            erpSystem: authContext?.tenantERP,
            createdBy: authContext?.tenantId ?? tenantId,
            source: source,
            erpInvoiceId: context.erpInvoiceId,
            metadata: {
              ...(context.metadata ?? {}),
              originalPayload: context.originalPayload,
              transformedInvoice: transformed,
            },
          });
          await outboundRepo.updateWorkflowState(irn, { transformed: true });
          transformed.tenant_id = authContext?.tenantId ?? tenantId;
        }

        if (transformed && irn) {
          const securePayload: SecureInvoice = {
            ...transformed,
            tenant_id: authContext?.tenantId ?? tenantId,
          };
          result = await outboundService.handleOutboundWorkflow(
            securePayload,
            true,
          );
          qrCode = result?.qrCode as string;
          firsSignedData = result?.data;
          transmissionFailed = !!result?.transmissionFailed;
        } else if (irn) {
          const qrResult = await outboundService.generateQRCode(
            irn,
            authContext?.tenantId ?? tenantId,
          );
          qrCode = qrResult?.qrCode;
          firsSignedData = qrResult?.data;
        }

        let finalStatus = OutboundInvoiceStatus.DELIVERED;
        let transmissionErrorMsg: string | undefined;

        if (transmissionFailed && !qrCode) {
          finalStatus = OutboundInvoiceStatus.TRANSMISTION_FAILED;
          transmissionErrorMsg = result?.transmissionError;
        }

        // ── Persist final state ─────────────────────────────────────────────────
        if (irn) {
          const currentInvoice = await outboundRepo.findByIrn(irn);
          const existingTransError =
            transmissionErrorMsg ??
            result?.transmissionError ??
            currentInvoice?.metadata?.transmissionError;

          await outboundRepo.update(irn, {
            qrCode,
            status: finalStatus,
            metadata: {
              ...(currentInvoice?.metadata ?? {}),
              ...(context.metadata ?? {}),
              transmissionError: existingTransError,
              firsSignedData,
              transformedInvoice: transformed,
            },
          });

          await outboundRepo.updateWorkflowState(irn, {
            transmitted: !transmissionFailed,
            delivered: !transmissionFailed || !!qrCode,
          });

          if (transmissionFailed && existingTransError) {
            await outboundRepo.setLastJobError(
              irn,
              "transmit",
              existingTransError,
            );
          }
        }

        logger.info("[Job:complete-outbound] Done — invoice finalized", {
          jobChainId,
          irn,
          status: finalStatus,
        });

        await chainNext(job, {
          qrCode,
          firsSignedData,
          irn,
          transformedInvoice: transformed,
        });
      } catch (err: any) {
        const { context } = job.attrs.data;
        if (context.irn) {
          await outboundRepo.update(context.irn, {
            status: OutboundInvoiceStatus.FAILED,
          });
        }
        await chainFail(job, err);
        throw err;
      }
    },
  );
}
