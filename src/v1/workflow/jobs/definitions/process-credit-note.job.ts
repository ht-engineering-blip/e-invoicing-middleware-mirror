import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";

const outboundRepo = new OutboundInvoiceRepository();

export function registerProcessCreditNoteJob(): void {
  agenda.define(
    "workflow:process-credit-note",
    async (job: Job<JobChainData>) => {
      const { tenantId, authContext, context, jobChainId } = job.attrs.data;

      logger.info("[Job:process-credit-note] Starting", {
        jobChainId,
        tenantId,
      });

      try {
        const payload = context.originalPayload;
        const referenceId =
          payload.referenceId ?? payload.reference_id ?? payload.invoiceId;
        const creditNoteId =
          payload.creditNoteId ??
          payload.credit_note_id ??
          context.erpInvoiceId;

        if (!referenceId) {
          throw new Error(
            "Missing referenceId or reference_id in credit note payload",
          );
        }

        logger.info("[Job:process-credit-note] Fetching original invoice", {
          referenceId,
        });

        // Fetch the original invoice from the database
        const originalInvoice =
          (await outboundRepo.findOne({
            tenantId: { _eq: tenantId },
            erpInvoiceId: { _eq: String(referenceId) },
          })) ?? (await outboundRepo.findByIrn(String(referenceId), tenantId));

        if (!originalInvoice) {
          throw new Error(
            `Original invoice not found for reference ID ${referenceId}`,
          );
        }

        const originalTransformed =
          originalInvoice.metadata?.transformedInvoice;
        if (!originalTransformed) {
          throw new Error(
            `Transformed invoice payload not found on original invoice ${referenceId}`,
          );
        }

        // Construct the credit note payload based on the original invoice
        const creditNotePayload = JSON.parse(
          JSON.stringify(originalTransformed),
        );

        // Convert to Credit Note
        creditNotePayload.invoice_type_code = "381";
        creditNotePayload.billing_reference = [
          {
            irn: originalInvoice.irn,
            issue_date:
              originalTransformed.issue_date ||
              originalInvoice.createdAt.toISOString().slice(0, 10),
          },
        ];

        // Assign credit note's own IRN
        const irn = context.irn;
        if (irn) {
          creditNotePayload.irn = irn;
        }

        // Set business_id from authContext if available
        if (authContext?.businessId) {
          creditNotePayload.business_id = authContext.businessId;
        }

        // Set current date/time for the credit note
        creditNotePayload.issue_date = new Date().toISOString().slice(0, 10);
        creditNotePayload.issue_time = new Date().toTimeString().slice(0, 8);

        // Update the invoice reference if we have one
        if (creditNoteId) {
          creditNotePayload.invoice_reference = String(creditNoteId);
        }

        // Save the credit note payload into the database record for the credit note
        if (irn) {
          await outboundRepo.update(
            irn,
            {
              metadata: {
                ...(originalInvoice.metadata ?? {}),
                transformedInvoice: creditNotePayload,
              },
            },
            tenantId,
          );
          await outboundRepo.updateWorkflowState(irn, { transformed: true });
        }

        logger.info(
          "[Job:process-credit-note] Processed credit note successfully",
          { jobChainId, irn },
        );

        await chainNext(job, { transformedInvoice: creditNotePayload, irn });
      } catch (err: any) {
        await chainFail(job, err);
        throw err;
      }
    },
  );
}
