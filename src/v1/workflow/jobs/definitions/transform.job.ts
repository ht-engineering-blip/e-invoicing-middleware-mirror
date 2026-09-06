import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { TransformWorkflowService } from "../../services";
import { OutboundInvoiceDocument, OutboundInvoiceSource } from "../../models";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { TenantRepository } from "../../../tenants/repos/tenant.repo";
import { resolveInvoiceTypeFromEvent } from "../../utils/invoice-type";

const transformService = new TransformWorkflowService();

export function registerTransformJob(): void {
  agenda.define("workflow:transform", async (job: Job<JobChainData>) => {
    const { tenantId, authContext, context, jobChainId, eventType } =
      job.attrs.data;
    const outboundRepo = new OutboundInvoiceRepository();
    logger.info("[Job:transform] Starting", { jobChainId, tenantId });
    console.log({ context: context.irn });
    if (context.irn) {
      context.originalPayload.irn = context.irn;
    }
    // The document type follows the event: erp.invoice.submitted is a
    // commercial invoice, erp.creditnote.issued is a credit note. Stamped on
    // the payload before transforming, so the completer's own default never
    // has to guess. A type already present on the payload is left alone.
    if (context.originalPayload && typeof context.originalPayload === "object") {
      const payload = context.originalPayload as Record<string, unknown>;
      if (!payload.invoice_type_code) {
        payload.invoice_type_code = resolveInvoiceTypeFromEvent(eventType);
      }
    }

    const tenantRepo = new TenantRepository();
    let effectiveAuthContext = (authContext || {}) as any;
    let effectiveSourceType = context.sourceType;

    if (tenantId && (!effectiveAuthContext?.tenantERP || !effectiveAuthContext?.tenantMappings)) {
      try {
        const tenantDoc = await tenantRepo.findByTenantId(tenantId);
        if (tenantDoc) {
          const tenantObj = typeof tenantDoc.toObject === "function" ? tenantDoc.toObject() : tenantDoc;
          effectiveAuthContext = {
            tenantId: tenantObj.tenantId,
            businessId: tenantObj.businessId || tenantObj.tenantId,
            businessTIN: tenantObj.metadata?.tin || tenantObj.config?.tin || tenantObj.tin,
            businessName: tenantObj.name,
            tenantERP: tenantObj.config?.erpSystem || tenantObj.metadata?.erpSystem || effectiveSourceType,
            tenantMappings: tenantObj.metadata?.webhookFieldMappings || tenantObj.config?.mappingRules || [],
            ...effectiveAuthContext,
          };
          if (!effectiveSourceType) {
            effectiveSourceType = effectiveAuthContext.tenantERP;
          }
        }
      } catch (tErr: any) {
        logger.warn("[Job:transform] Failed to load tenant record for job context", { error: tErr.message });
      }
    }

    try {
      const result = await transformService.transformInvoiceV2(
        context.originalPayload,
        effectiveAuthContext,
        effectiveSourceType,
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
          metadata: {
            ...(result.metadata ?? {}),
            originalPayload: context.originalPayload,
            transformedInvoice: result,
          },
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
