import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { OutboundWorkflowService } from "../../services";
import { TransformWorkflowService } from "../../services";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { OutboundInvoiceStatus, OutboundInvoiceSource } from "../../models";
import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { Currency } from "../../../../@lib/adapters/firs/types";
import { resolveCurrencyCode } from "../../utils/transformer/utils";

const outboundService = new OutboundWorkflowService();
const transformService = new TransformWorkflowService();
const outboundRepo = new OutboundInvoiceRepository();
const firsService = new FIRSService();

export function registerCompleteOutboundJob(): void {
  agenda.define(
    "workflow:complete-outbound",
    async (job: Job<JobChainData>) => {
      const { tenantId, authContext, context, jobChainId } = job.attrs.data;

      logger.info("[Job:complete-outbound] Starting", {
        jobChainId,
        tenantId,
        mode: context.transformedInvoice ? "finalize" : "full-pipeline",
      });

      try {
        let irn = context.irn;
        let qrCode: string | undefined;
        let firsSignedData: any;
        let transmissionFailed = false;

        if (!context.transformedInvoice) {
          // ── Full-pipeline mode ────────────────────────────────────────────────
          // Used when complete_outbound is the ONLY action (standalone invocation).
          // Runs: transform → validate + sign + confirm + QR + transmit (via handleOutboundWorkflow)

          logger.info("[Job:complete-outbound] Full-pipeline mode", {
            jobChainId,
            irn,
            tenantId,
          });

          // Step 1: Transform ERP payload → FIRS format
          const transformed = await transformService.transformInvoiceV2(
            context.originalPayload,
            authContext,
            context.sourceType,
          );

          // Step 2: Ensure IRN is on the transformed invoice
          irn = irn ?? transformed.irn;
          if (irn) transformed.irn = irn;

          // Step 2.5: Resolve currencies and apply fallback checks
          let currencies: Currency[] = [];
          try {
            currencies = await firsService.getResource<Currency>("currencies");
          } catch {
            // fallback gracefully
          }

          const fallbackCurrency = resolveCurrencyCode(
            transformed.document_currency_code || transformed.tax_currency_code,
            currencies,
          );

          transformed.tax_currency_code = transformed.tax_currency_code
            ? resolveCurrencyCode(transformed.tax_currency_code, currencies)
            : fallbackCurrency;

          transformed.document_currency_code =
            transformed.document_currency_code
              ? resolveCurrencyCode(
                  transformed.document_currency_code,
                  currencies,
                )
              : fallbackCurrency;

          // Step 3: Persist invoice record
          if (irn) {
            const source = context.source as OutboundInvoiceSource;
            await outboundRepo.upsertByIrn({
              irn,
              tenantId: authContext?.tenantId,
              erpSystem: authContext?.tenantERP,
              createdBy: authContext?.tenantId,
              source: source ?? OutboundInvoiceSource.API,
              erpInvoiceId: context.erpInvoiceId,
              metadata: { transformedInvoice: transformed },
            });
            await outboundRepo.updateWorkflowState(irn, { transformed: true });
            transformed.tenant_id = tenantId;
          }

          console.log("TRANSFORM PAYLOAD DATA", { transformed });

          // Step 4: validate → sign (if needed) → confirm → QR → transmit
          const result = await outboundService.handleOutboundWorkflow(
            transformed,
            true,
          );
          qrCode = result.qrCode as string;
          firsSignedData = result.data;
          transmissionFailed = !!result.transmissionFailed;
        } else {
          // ── Finalize mode ─────────────────────────────────────────────────────
          // Used as the LAST step in a chain where individual steps already ran.
          // Generates QR code and marks the invoice workflow as DELIVERED.

          logger.info("[Job:complete-outbound] Finalize mode", {
            jobChainId,
            irn,
          });

          if (!irn) {
            throw new Error(
              "IRN is required for complete-outbound finalize step",
            );
          }

          if (context.transmissionFailed) transmissionFailed = true;

          const result = await outboundService.generateQRCode(irn, tenantId);
          qrCode = result.qrCode;
          firsSignedData = result.data;
        }

        let finalStatus = OutboundInvoiceStatus.DELIVERED;

        if (transmissionFailed) {
          finalStatus = OutboundInvoiceStatus.TRANSMISTION_FAILED;
        }

        // ── Persist final state ─────────────────────────────────────────────────
        if (irn) {
          await outboundRepo.update(irn, {
            qrCode,
            status: finalStatus,
            metadata: {
              ...(context.metadata ?? {}),
              ...(context.transformedInvoice
                ? { transformedInvoice: context.transformedInvoice }
                : {}),
              firsSignedData,
            },
          });

          // Mark delivered: true so the Delivered progress badge turns green
          await outboundRepo.updateWorkflowState(irn, { delivered: true });
        }

        logger.info("[Job:complete-outbound] Done — invoice finalized", {
          jobChainId,
          irn,
          status: finalStatus,
        });

        await chainNext(job, { qrCode, firsSignedData, irn });
      } catch (err: any) {
        const { context } = job.attrs.data;
        if (context.irn) {
          await outboundRepo.update(context.irn, {
            status: OutboundInvoiceStatus.FAILED,
          });
        }
        await chainFail(job, err);
        throw err;
      }
    },
  );
}
