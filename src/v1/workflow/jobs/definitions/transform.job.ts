import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { TransformWorkflowService } from "../../services";
import { OutboundInvoiceDocument, OutboundInvoiceSource } from "../../models";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { TenantRepository } from "../../../tenants/repos/tenant.repo";

const transformService = new TransformWorkflowService();

/**
 * Merges tenant values loaded from the tenant record with the authContext the
 * job was scheduled with.
 *
 * The job's own values win, but ONLY where they actually carry something. The
 * orchestrator always emits keys like `tenantERP` explicitly, and Agenda's
 * Mongo round-trip turns an `undefined` value into `null`, so spreading the
 * job context last (as this previously did) put that empty value straight back
 * over the value just loaded from the tenant and the hydration never took
 * effect — on the first run or on a retry.
 */
export function mergeTenantContext(
  hydrated: Record<string, any>,
  existing: Record<string, any>,
): Record<string, any> {
  const merged: Record<string, any> = { ...hydrated };
  for (const [key, value] of Object.entries(existing || {})) {
    if (value !== undefined && value !== null && value !== "") {
      merged[key] = value;
    }
  }
  return merged;
}

export function registerTransformJob(): void {
  agenda.define("workflow:transform", async (job: Job<JobChainData>) => {
    const { tenantId, authContext, context, jobChainId } = job.attrs.data;
    const outboundRepo = new OutboundInvoiceRepository();
    logger.info("[Job:transform] Starting", { jobChainId, tenantId });
    console.log({ context: context.irn });
    if (context.irn) {
      context.originalPayload.irn = context.irn;
    }
    const tenantRepo = new TenantRepository();
    let effectiveAuthContext = (authContext || {}) as any;
    let effectiveSourceType = context.sourceType;

    if (tenantId && (!effectiveAuthContext?.tenantERP || !effectiveAuthContext?.tenantMappings)) {
      try {
        const tenantDoc = await tenantRepo.findByTenantId(tenantId);
        if (tenantDoc) {
          const tenantObj = typeof tenantDoc.toObject === "function" ? tenantDoc.toObject() : tenantDoc;
          const hydrated: Record<string, any> = {
            tenantId: tenantObj.tenantId,
            businessId: tenantObj.businessId || tenantObj.tenantId,
            businessTIN: tenantObj.metadata?.tin || tenantObj.config?.tin || tenantObj.tin,
            businessName: tenantObj.name,
            tenantERP: tenantObj.config?.erpSystem || tenantObj.metadata?.erpSystem || effectiveSourceType,
            tenantMappings: tenantObj.metadata?.webhookFieldMappings || tenantObj.config?.mappingRules || [],
          };

          effectiveAuthContext = mergeTenantContext(
            hydrated,
            effectiveAuthContext,
          );
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
          tenantId: effectiveAuthContext?.tenantId ?? tenantId,
          erpSystem: effectiveAuthContext?.tenantERP ?? effectiveSourceType,
          createdBy: effectiveAuthContext?.tenantId ?? tenantId,
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
