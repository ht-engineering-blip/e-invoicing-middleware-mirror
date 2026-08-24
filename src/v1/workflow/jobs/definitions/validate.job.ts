import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { InvoiceWorkflowService } from "../../../invoicing/services";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { OutboundInvoiceStatus } from "../../models";

const invoiceService = new InvoiceWorkflowService();

export function registerValidateJob(): void {
  agenda.define("workflow:validate", async (job: Job<JobChainData>) => {
    const { tenantId, authContext, context, jobChainId } = job.attrs.data;

    logger.info("[Job:validate] Starting", { jobChainId, tenantId });

    try {
      // transformedInvoice is the FIRS-formatted output from the transform step.
      // originalPayload is the raw ERP data. Prefer transformedInvoice; only
      // fall back to originalPayload if no transform step ran before this one.
      const invoice = context.transformedInvoice ?? context.originalPayload;
      const result = await invoiceService.validateInvoice(
        authContext.businessId || tenantId,
        invoice,
      );

      if (!result.valid) {
        const errorDetail = Array.isArray(result.errors)
          ? result.errors.join("; ")
          : (result.errors || result.message || "Validation failed");
        throw new Error(`Invoice validation failed: ${errorDetail}`);
      }

      logger.info("[Job:validate] Passed", { jobChainId });

      if (context.irn) {
        const outboundRepo = new OutboundInvoiceRepository();
        await outboundRepo.update(context.irn, {
          status: OutboundInvoiceStatus.VALIDATED,
        });
        await outboundRepo.updateWorkflowState(context.irn, {
          validated: true,
        });
      }

      await chainNext(job, { validationResult: result });
    } catch (err: any) {
      await chainFail(job, err);
      throw err;
    }
  });
}
