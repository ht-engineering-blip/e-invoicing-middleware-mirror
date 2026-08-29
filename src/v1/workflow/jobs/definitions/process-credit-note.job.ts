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
        const eventType = job.attrs.data.eventType;

        const idKey =
          authContext?.idKeyMap?.[eventType] ??
          authContext?.idKeyMap?.[eventType?.replace(/\./g, "_")];
        const creditNoteId =
          (idKey ? getNestedValue(payload, idKey) : undefined) ??
          (idKey && idKey.startsWith("data.")
            ? getNestedValue(payload, idKey.replace(/^data\./, ""))
            : undefined) ??
          payload?.data?.invoice_id ??
          payload?.invoice_id ??
          payload?.data?.invoiceId ??
          payload?.invoiceId ??
          context.erpInvoiceId;

        const refKey =
          authContext?.referenceIdKeyMap?.[eventType] ??
          authContext?.referenceIdKeyMap?.[eventType?.replace(/\./g, "_")];

        const extractReferenceIds = (value: any): string[] => {
          if (!value) return [];
          const list = Array.isArray(value) ? value : [value];
          const ids: string[] = [];
          for (const item of list) {
            if (!item) continue;
            if (typeof item === "string" || typeof item === "number") {
              ids.push(String(item).trim());
            } else if (typeof item === "object") {
              const candidate =
                item.irn ??
                item.invoice_id ??
                item.invoice_number ??
                item.id ??
                item.referenceId;
              if (candidate) {
                ids.push(String(candidate).trim());
              }
            }
          }
          return ids;
        };

        const configuredRef =
          (refKey ? getNestedValue(payload, refKey) : undefined) ??
          (refKey && refKey.startsWith("data.")
            ? getNestedValue(payload, refKey.replace(/^data\./, ""))
            : undefined) ??
          payload?.data?.billing_reference ??
          payload?.billing_reference ??
          payload?.data?.referenceId ??
          payload?.referenceId;

        const referenceIds = extractReferenceIds(configuredRef);

        if (referenceIds.length === 0) {
          throw new Error(
            "Missing billing reference or reference ID in credit note payload",
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

          originalInvoices.push(originalInvoice);

          billingReferences.push({
            irn: originalInvoice.irn,
            issue_date:
              originalTransformed?.issue_date ||
              (originalInvoice.createdAt
                ? new Date(originalInvoice.createdAt).toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10)),
          });
        }

        const fallbackOriginalInvoice = originalInvoices[0];
        const fallbackOriginalTransformed =
          fallbackOriginalInvoice?.metadata?.transformedInvoice;

        // 2. Transform or clone into credit note payload
        const lines = payload.data?.invoice_line ?? payload.invoice_line;
        const hasLines = Array.isArray(lines) && lines.length > 0;

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
          if (!fallbackOriginalTransformed) {
            throw new Error(
              `Transformed invoice payload not found on original invoice ${referenceIds[0]}`,
            );
          }
          logger.info(
            "[Job:process-credit-note] Minimal credit note payload detected — cloning original...",
            { jobChainId },
          );
          creditNotePayload = structuredClone(fallbackOriginalTransformed);
        }

        // Dynamically set invoice_type_code from payload or default to 380
        const resolvedInvoiceTypeCode =
          payload.data?.invoice_type_code ??
          payload.invoice_type_code ??
          (hasLines ? creditNotePayload.invoice_type_code : "380");

        creditNotePayload.invoice_type_code = String(
          resolvedInvoiceTypeCode,
        ).trim();

        // Assign billing reference (use incoming if provided, otherwise resolved from original invoice)
        const incomingBillingRefs =
          payload.data?.billing_reference ?? payload.billing_reference;

        if (
          Array.isArray(incomingBillingRefs) &&
          incomingBillingRefs.length > 0
        ) {
          creditNotePayload.billing_reference = incomingBillingRefs.map(
            (ref: any) => ({
              irn:
                typeof ref === "object"
                  ? (ref.irn ?? ref.invoice_id ?? fallbackOriginalInvoice.irn)
                  : String(ref),
              issue_date:
                typeof ref === "object"
                  ? (ref.issue_date ?? fallbackOriginalTransformed.issue_date)
                  : fallbackOriginalTransformed.issue_date,
            }),
          );
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
