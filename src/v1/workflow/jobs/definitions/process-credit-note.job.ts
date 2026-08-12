import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { TransformWorkflowService } from "../../services";
import { getNestedValue } from "../../../../@lib";

const outboundRepo = new OutboundInvoiceRepository();
const transformService = new TransformWorkflowService();

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

        const refKey =
          authContext?.referenceIdKeyMap?.[job.attrs.data.eventType];
        const creditNoteId = context.erpInvoiceId;
        const referenceIds: string[] = [];

        if (refKey) {
          const configuredRef = getNestedValue(payload, refKey);
          if (Array.isArray(configuredRef)) {
            referenceIds.push(...configuredRef.map(String));
          } else if (configuredRef) {
            referenceIds.push(String(configuredRef));
          }
        } else {
          // Legacy fallback to prevent breaking existing integrations
          const referenceId =
            payload.referenceId ?? payload.reference_id ?? payload.invoiceId;
          if (Array.isArray(payload.referenceIds)) {
            referenceIds.push(...payload.referenceIds.map(String));
          } else if (Array.isArray(payload.reference_ids)) {
            referenceIds.push(...payload.reference_ids.map(String));
          } else if (referenceId) {
            referenceIds.push(String(referenceId));
          }
        }

        if (referenceIds.length === 0) {
          throw new Error(
            "Missing referenceId, reference_id, or referenceIds in credit note payload",
          );
        }

        logger.info("[Job:process-credit-note] Fetching original invoice(s)", {
          referenceIds,
        });

        const billingReferences: any[] = [];
        const originalInvoices: any[] = [];

        for (const refId of referenceIds) {
          const originalInvoice =
            (await outboundRepo.findOne({
              tenantId: { _eq: tenantId },
              erpInvoiceId: { _eq: String(refId) },
            })) ?? (await outboundRepo.findByIrn(String(refId), tenantId));

          if (!originalInvoice) {
            throw new Error(
              `Original invoice not found for reference ID ${refId}`,
            );
          }

          const originalTransformed =
            originalInvoice.metadata?.transformedInvoice;
          if (!originalTransformed) {
            throw new Error(
              `Transformed invoice payload not found on original invoice ${refId}`,
            );
          }

          originalInvoices.push(originalInvoice);

          billingReferences.push({
            irn: originalInvoice.irn,
            issue_date:
              originalTransformed.issue_date ||
              originalInvoice.createdAt.toISOString().slice(0, 10),
          });
        }

        const fallbackOriginalInvoice = originalInvoices[0];
        const fallbackOriginalTransformed =
          fallbackOriginalInvoice.metadata.transformedInvoice;

        // Check if this is a full credit note payload containing items/lines
        const hasLines =
          Array.isArray(payload.invoice_line) ||
          Array.isArray(payload.items) ||
          Array.isArray(payload.invoiceLine);

        let creditNotePayload: any;

        if (hasLines) {
          logger.info(
            "[Job:process-credit-note] Full credit note payload detected — transforming...",
            { jobChainId },
          );
          creditNotePayload = await transformService.transformInvoiceV2(
            payload,
            authContext as any,
            context.sourceType,
          );
        } else {
          logger.info(
            "[Job:process-credit-note] Minimal credit note payload detected — cloning original...",
            { jobChainId },
          );
          // Construct the credit note payload based on the first original invoice
          creditNotePayload = JSON.parse(
            JSON.stringify(fallbackOriginalTransformed),
          );
        }

        // Convert to Credit Note
        creditNotePayload.invoice_type_code = "381";

        // Preserve billing_reference if already provided in the webhook payload, otherwise use resolved ones
        if (
          Array.isArray(payload.billing_reference) &&
          payload.billing_reference.length > 0
        ) {
          creditNotePayload.billing_reference = payload.billing_reference;
        } else if (
          Array.isArray(payload.billing_references) &&
          payload.billing_references.length > 0
        ) {
          creditNotePayload.billing_reference = payload.billing_references;
        } else {
          creditNotePayload.billing_reference = billingReferences;
        }

        // Assign credit note's own IRN
        const irn = context.irn;
        if (irn) {
          creditNotePayload.irn = irn;
        }

        // Set business_id from authContext if available
        if (authContext?.businessId) {
          creditNotePayload.business_id = authContext.businessId;
        }

        // Set current date/time for the credit note if not already set
        if (!creditNotePayload.issue_date) {
          creditNotePayload.issue_date = new Date().toISOString().slice(0, 10);
        }
        if (!creditNotePayload.issue_time) {
          creditNotePayload.issue_time = new Date().toTimeString().slice(0, 8);
        }

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
                ...(fallbackOriginalInvoice.metadata ?? {}),
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
