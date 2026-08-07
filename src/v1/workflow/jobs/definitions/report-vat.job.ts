import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { InvoiceWorkflowService } from "../../../invoicing/services";

const invoiceService = new InvoiceWorkflowService();

export function registerReportVatJob(): void {
  agenda.define("workflow:report-vat", async (job: Job<JobChainData>) => {
    const { tenantId, context, jobChainId } = job.attrs.data;

    logger.info("[Job:report-vat] Starting", { jobChainId, tenantId });

    try {
      if (!context.irn) {
        throw new Error("IRN is required for report_vat step");
      }

      const vatData =
        context.vatReportData ?? context.originalPayload?.vatReportData;
      if (!vatData) {
        throw new Error(
          "VAT report data not found in context or originalPayload.vatReportData",
        );
      }

      const result = await invoiceService.reportInvoice({
        ...vatData,
        irn: context.irn,
      });

      logger.info("[Job:report-vat] Reported", {
        jobChainId,
        irn: context.irn,
      });

      await chainNext(job, { vatReportResult: result });
    } catch (err: any) {
      await chainFail(job, err);
      throw err;
    }
  });
}
