import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { OutboundWorkflowService } from "../../services";
import { TransformWorkflowService } from "../../services";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { OutboundInvoiceStatus, OutboundInvoiceSource } from "../../models";
import { buildQrUrl, getNestedValue } from "../../../../@lib";
import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { Currency } from "../../../../@lib/adapters/firs/types";
import { resolveCurrencyCode } from "../../utils/transformer/utils";

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
      const businessId = authContext?.businessId ?? tenantId;

      logger.info("[Job:complete-credit-note] Starting", {
        jobChainId,
        tenantId,
        mode: context.transformedInvoice ? "finalize" : "full-pipeline",
      });

      let irn = context.irn;

      try {
        let qrCode: string | undefined;
        let firsSignedData: any;
        let creditNotePayload = context.transformedInvoice;
        let source = context.source as OutboundInvoiceSource;

        if (!context.transformedInvoice) {
          // ── Full-pipeline mode ────────────────────────────────────────────────
          // Used when complete_credit_note is the action for credit note processing.
          // Runs: Resolve original invoice → Transform/Clone Credit Note → validate + sign + QR + transmit

          logger.info("[Job:complete-credit-note] Full-pipeline mode", {
            jobChainId,
          });

          const payload = context.originalPayload;

          console.log(
            "[DEBUG:complete-credit-note] Payload inspection:",
            JSON.stringify(
              {
                eventType,
                hasPayload: !!payload,
                payloadKeys: payload ? Object.keys(payload) : [],
                payloadSample: payload,
                refKeyMap: authContext?.referenceIdKeyMap,
                idKeyMap: authContext?.idKeyMap,
              },
              null,
              2,
            ),
          );

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

          logger.info(
            "[Job:complete-credit-note] Fetching original invoice(s)",
            { referenceIds },
          );

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
                  ? new Date(originalInvoice.createdAt)
                      .toISOString()
                      .slice(0, 10)
                  : new Date().toISOString().slice(0, 10)),
            });
          }

          const fallbackOriginalInvoice = originalInvoices[0];
          const fallbackOriginalTransformed =
            fallbackOriginalInvoice?.metadata?.transformedInvoice;

          // 2. Transform or clone into credit note payload
          const lines = payload.data?.invoice_line ?? payload.invoice_line;
          const hasLines = Array.isArray(lines) && lines.length > 0;

          if (hasLines) {
            logger.info(
              "[Job:complete-credit-note] Full credit note payload detected — transforming...",
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
              "[Job:complete-credit-note] Minimal credit note payload detected — cloning original...",
              { jobChainId },
            );
            creditNotePayload = JSON.parse(
              JSON.stringify(fallbackOriginalTransformed),
            );
          }

          // Dynamically set invoice_type_code from payload or default to 381
          const resolvedInvoiceTypeCode =
            payload.data?.invoice_type_code ??
            payload.invoice_type_code ??
            (hasLines ? creditNotePayload.invoice_type_code : "381");

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
            creditNotePayload.billing_reference = billingReferences;
          }

          // Inherit supplier and customer parties from original invoice if missing or default on credit note
          if (
            fallbackOriginalTransformed?.accounting_supplier_party &&
            (!creditNotePayload.accounting_supplier_party ||
              !creditNotePayload.accounting_supplier_party.tin)
          ) {
            creditNotePayload.accounting_supplier_party =
              fallbackOriginalTransformed.accounting_supplier_party;
          }

          if (
            fallbackOriginalTransformed?.accounting_customer_party &&
            (!creditNotePayload.accounting_customer_party ||
              !creditNotePayload.accounting_customer_party.tin ||
              creditNotePayload.accounting_customer_party.tin === "00000000-0000")
          ) {
            creditNotePayload.accounting_customer_party =
              fallbackOriginalTransformed.accounting_customer_party;
          }

          // Assign credit note's own IRN
          irn = irn ?? creditNotePayload.irn;
          if (irn) {
            creditNotePayload.irn = irn;
            job.attrs.data.context.irn = irn;
          }

          if (authContext?.businessId) {
            creditNotePayload.business_id = authContext.businessId;
          }

          if (!creditNotePayload.issue_date) {
            creditNotePayload.issue_date = new Date()
              .toISOString()
              .slice(0, 10);
          }
          if (!creditNotePayload.issue_time) {
            creditNotePayload.issue_time = new Date()
              .toTimeString()
              .slice(0, 8);
          }

          let currencies: Currency[] = [];
          try {
            currencies = await firsService.getResource<Currency>("currencies");
          } catch {
            // fallback gracefully
          }

          const fallbackCurrency = resolveCurrencyCode(
            creditNotePayload.document_currency_code ||
              creditNotePayload.tax_currency_code ||
              fallbackOriginalTransformed?.document_currency_code ||
              fallbackOriginalTransformed?.tax_currency_code,
            currencies,
          );

          creditNotePayload.tax_currency_code = creditNotePayload.tax_currency_code
            ? resolveCurrencyCode(creditNotePayload.tax_currency_code, currencies)
            : fallbackCurrency;

          creditNotePayload.document_currency_code = creditNotePayload.document_currency_code
            ? resolveCurrencyCode(creditNotePayload.document_currency_code, currencies)
            : fallbackCurrency;

          if (creditNoteId) {
            creditNotePayload.invoice_reference = String(creditNoteId);
          }

          // Persist initial transformed credit note state
          if (irn) {
            await outboundRepo.upsertByIrn({
              irn,
              tenantId: authContext?.tenantId ?? tenantId,
              erpSystem: authContext?.tenantERP,
              createdBy: authContext?.tenantId,
              source: source ?? OutboundInvoiceSource.WEBHOOK,
              erpInvoiceId: creditNoteId ?? context.erpInvoiceId,
              metadata: {
                ...(fallbackOriginalInvoice.metadata ?? {}),
                transformedInvoice: creditNotePayload,
              },
            });
            await outboundRepo.updateWorkflowState(irn, { transformed: true });
            creditNotePayload.tenant_id = tenantId;
          }

          // 3. Outbound workflow: Validate → Sign → Transmit → QR
          logger.info(
            "[Job:complete-credit-note] Executing outbound workflow (validate → sign → transmit → QR)...",
            { jobChainId, irn },
          );

          const outboundResult = await outboundService.handleOutboundWorkflow(
            creditNotePayload,
            true,
          );

          qrCode = outboundResult.qrCode as string;
          firsSignedData = outboundResult.data;
        } else {
          // ── Finalize mode ─────────────────────────────────────────────────────
          // Used as the LAST step in a chain where individual steps already ran.
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
          qrCode = result.qrCode!;
          firsSignedData = result.data;
        }

        // ── Persist final state ─────────────────────────────────────────────────
        if (irn) {
          await outboundRepo.update(
            irn,
            {
              qrCode,
              status: OutboundInvoiceStatus.DELIVERED,
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
          await outboundRepo.updateWorkflowState(irn, { delivered: true });
        }

        logger.info("[Job:complete-credit-note] Done — credit note DELIVERED", {
          jobChainId,
          irn,
        });

        await chainNext(job, {
          transformedInvoice: creditNotePayload,
          qrCode: buildQrUrl(irn, !!qrCode) as string,
          firsSignedData,
          irn,
        });
      } catch (err: any) {
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
