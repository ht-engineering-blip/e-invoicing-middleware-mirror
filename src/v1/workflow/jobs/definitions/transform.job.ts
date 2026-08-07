import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { TransformWorkflowService } from "../../services";
import { OutboundInvoiceDocument, OutboundInvoiceSource } from "../../models";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";

const transformService = new TransformWorkflowService();

export function registerTransformJob(): void {
  agenda.define("workflow:transform", async (job: Job<JobChainData>) => {
    const { tenantId, authContext, context, jobChainId } = job.attrs.data;
    const outboundRepo = new OutboundInvoiceRepository();
    logger.info("[Job:transform] Starting", { jobChainId, tenantId });
    console.log({ context: context.irn });
    if (context.irn) {
      context.originalPayload.irn = context.irn;
    }
    try {
      const result = await transformService.transformInvoiceV2(
        context.originalPayload,
        authContext as any,
        context.sourceType,
      );

      // Prefer the pre-stored IRN from context so the upsert filter always
      // hits the existing doc instead of trying to insert a new one.
      const irn = context.irn ?? result.irn;
      if (irn) {
        const upsertPayload: Partial<OutboundInvoiceDocument> = {
          irn,
          tenantId: authContext?.tenantId ?? tenantId,
          erpSystem: authContext?.tenantERP,
          createdBy: authContext?.tenantId ?? tenantId,
          source:
            (context.source as OutboundInvoiceSource) ??
            OutboundInvoiceSource.API,
          erpInvoiceId: context.erpInvoiceId,
          metadata: { ...(result.metadata ?? {}), transformedInvoice: result },
        };
        await outboundRepo.upsertByIrn(upsertPayload);
        await outboundRepo.updateWorkflowState(irn, { transformed: true });
      }

      logger.info("[Job:transform] Done", { jobChainId });

      await chainNext(job, { transformedInvoice: result });
    } catch (err: any) {
      await chainFail(job, err);
      throw err;
    }
  });
}
