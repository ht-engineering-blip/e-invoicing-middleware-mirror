import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { InvoiceWorkflowService } from "../../../invoicing/services";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { OutboundInvoiceStatus } from "../../models";

const invoiceService = new InvoiceWorkflowService();

export function registerSignJob(): void {
  agenda.define("workflow:sign", async (job: Job<JobChainData>) => {
    const { tenantId, authContext, context, jobChainId } = job.attrs.data;

    logger.info("[Job:sign] Starting", { jobChainId, tenantId });

    try {
      const invoice = context.transformedInvoice ?? context.originalPayload;
      const result = await invoiceService.signInvoice(
        authContext as any,
        invoice,
      );

      if (!result.signed) {
        const errorDetail = Array.isArray(result.errors)
          ? result.errors.join("; ")
          : (result.errors || result.message || "Signing failed");
        throw new Error(`Invoice signing failed: ${errorDetail}`);
      }

      logger.info("[Job:sign] Signed", { jobChainId });

      const irn = context.irn ?? (result.data as any)?.irn;
      if (irn) {
        const outboundRepo = new OutboundInvoiceRepository();
        await outboundRepo.update(irn, {
          status: OutboundInvoiceStatus.SIGNED,
        });
        await outboundRepo.updateWorkflowState(irn, {
          signed: true,
        });
      }

      await chainNext(job, { signedInvoice: result.data });
    } catch (err: any) {
      await chainFail(job, err);
      throw err;
    }
  });
}
