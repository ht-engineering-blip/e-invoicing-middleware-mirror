import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import {
  OutboundWorkflowService,
  TransformWorkflowService,
} from "../../services";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { OutboundInvoiceStatus, OutboundInvoiceSource } from "../../models";
import { buildQrUrl } from "../../../../@lib";
import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import {
  CreditNotePayload,
  resolveOriginalInvoices,
  composeCreditNotePayload,
} from "../../utils/credit-note-pipeline.helper";

const outboundService = new OutboundWorkflowService();
const transformService = new TransformWorkflowService();
const outboundRepo = new OutboundInvoiceRepository();
const firsService = new FIRSService();

export function registerCompleteCreditNoteJob(): void {
  agenda.define(
    "workflow:complete-credit-note",
    async (job: Job<JobChainData>) => {
      const { tenantId, authContext, context, jobChainId, eventType } =
        job.attrs.data;

      logger.info("[Job:complete-credit-note] Starting", {
        jobChainId,
        tenantId,
        mode: context.transformedInvoice ? "finalize" : "full-pipeline",
      });

      let irn = context.irn;

      try {
        let qrCode: string | undefined;
        let firsSignedData: unknown;
        let creditNotePayload = context.transformedInvoice as
          | CreditNotePayload
          | undefined;
        const source =
          (context.source as OutboundInvoiceSource) ??
          OutboundInvoiceSource.WEBHOOK;
        let transmissionFailed = false;

        if (!context.transformedInvoice) {
          // 1. Full-pipeline mode: Resolve references & assemble credit note payload
          const rawPayload = (context.originalPayload || {}) as Record<
            string,
            unknown
          >;
          const resolvedOriginals = await resolveOriginalInvoices(
            rawPayload,
            authContext,
            eventType,
            tenantId,
            outboundRepo,
            context.erpInvoiceId,
          );

          irn =
            irn ??
            (resolvedOriginals.originalInvoices[0]?.irn
              ? undefined
              : undefined);

          creditNotePayload = await composeCreditNotePayload({
            payload: rawPayload,
            resolvedOriginals,
            authContext,
            tenantId,
            irn,
            sourceType: context.sourceType,
            firsService,
            transformService,
          });

          irn = irn ?? creditNotePayload.irn;
          if (irn) {
            job.attrs.data.context.irn = irn;
            await outboundRepo.upsertByIrn({
              irn,
              tenantId: authContext?.tenantId ?? tenantId,
              erpSystem: authContext?.tenantERP,
              createdBy: authContext?.tenantId,
              source,
              erpInvoiceId:
                resolvedOriginals.creditNoteId ?? context.erpInvoiceId,
              metadata: {
                ...(resolvedOriginals.originalInvoices[0]?.metadata ?? {}),
                transformedInvoice: creditNotePayload,
              },
            });
            await outboundRepo.updateWorkflowState(irn, { transformed: true });
          }

          // 2. Transmit outbound workflow
          logger.info(
            "[Job:complete-credit-note] Executing outbound workflow (validate → sign → transmit → QR)...",
            { jobChainId, irn },
          );

          const outboundResult = await outboundService.handleOutboundWorkflow(
            creditNotePayload as any,
            true,
          );

          qrCode = outboundResult.qrCode as string;
          firsSignedData = outboundResult.data;
          transmissionFailed = Boolean(outboundResult.transmissionFailed);
        } else {
          // Finalize mode
          logger.info("[Job:complete-credit-note] Finalize mode", {
            jobChainId,
            irn,
          });

          if (!irn) {
            throw new Error(
              "IRN is required for complete-credit-note finalize step",
            );
          }

          const result = await outboundService.generateQRCode(
            irn,
            authContext?.tenantId ?? tenantId,
          );
          qrCode = result.qrCode;
          firsSignedData = result.data;
        }

        // 3. Persist final state
        if (irn) {
          const finalStatus = transmissionFailed
            ? OutboundInvoiceStatus.TRANSMISTION_FAILED
            : OutboundInvoiceStatus.DELIVERED;

          await outboundRepo.update(
            irn,
            {
              qrCode,
              status: finalStatus,
              metadata: {
                ...(context.metadata ?? {}),
                ...(creditNotePayload
                  ? { transformedInvoice: creditNotePayload }
                  : {}),
                firsSignedData,
              },
            },
            tenantId,
          );

          if (!transmissionFailed) {
            await outboundRepo.updateWorkflowState(irn, { delivered: true });
          }
        }

        logger.info("[Job:complete-credit-note] Done — credit note DELIVERED", {
          jobChainId,
          irn,
        });

        await chainNext(job, {
          transformedInvoice: creditNotePayload,
          qrCode: buildQrUrl(irn, Boolean(qrCode)) as string,
          firsSignedData,
          irn,
        });
      } catch (err: unknown) {
        const resolvedIrn = irn || job.attrs.data.context?.irn;
        if (resolvedIrn) {
          job.attrs.data.context.irn = resolvedIrn;
          await outboundRepo
            .update(
              resolvedIrn,
              { status: OutboundInvoiceStatus.FAILED },
              job.attrs.data.tenantId,
            )
            .catch(() => {});
        }
        await chainFail(job, err);
        throw err;
      }
    },
  );
}
