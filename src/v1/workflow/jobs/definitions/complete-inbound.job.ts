import type { Job } from "agenda";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { InboundWorkflowService } from "../../services";

const inboundService = new InboundWorkflowService();

export function registerCompleteInboundJob(): void {
  agenda.define("workflow:complete-inbound", async (job: Job<JobChainData>) => {
    const { tenantId, context, jobChainId } = job.attrs.data;

    // Resolves to the IRN whether this job runs standalone or at the end of a chain.
    // handleInboundWorkflow is itself the full inbound pipeline (download → decrypt
    // → save → acknowledge), so there is no separate "finalize" mode here.
    const irn =
      context.irn ??
      context.originalPayload?.irn ??
      context.originalPayload?.invoice?.irn;

    logger.info("[Job:complete-inbound] Starting", {
      jobChainId,
      tenantId,
      irn,
    });

    try {
      if (!irn) throw new Error("IRN is required for complete-inbound step");

      const result = await inboundService.handleInboundWorkflow({ irn, tenant_id: tenantId });

      if (!result.status) {
        throw new Error(('error' in result ? result.error : undefined) ?? "Inbound workflow failed");
      }

      logger.info("[Job:complete-inbound] Done", { jobChainId });

      await chainNext(job, { inboundResult: result.data });
    } catch (err: any) {
      await chainFail(job, err);
      throw err;
    }
  });
}
