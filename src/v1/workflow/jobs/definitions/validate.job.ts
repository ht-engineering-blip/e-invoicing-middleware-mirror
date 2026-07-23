import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { InvoiceWorkflowService } from "../../../invoicing/services";

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
        throw new Error(`Error: ${(result.errors ?? []).join("; ")}`);
      }

      logger.info("[Job:validate] Passed", { jobChainId });

      await chainNext(job, { validationResult: result });
    } catch (err: any) {
      await chainFail(job, err);
      throw err;
    }
  });
}
