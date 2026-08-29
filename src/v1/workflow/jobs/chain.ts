import type { Job } from "agenda";
import { agenda } from "../../../@lib/queue/agenda";
import { logger } from "../../../@lib/logger";
import { WebhookEventRepository } from "../../webhook/repos/webhook-event.repo";
import { ACTION_TO_JOB } from "./types";
import { OutboundInvoiceStatus } from "../models/outbound-invoice.model";

const webhookEventRepo = new WebhookEventRepository();

// Lazy-loaded to avoid circular dependency at module load time
async function getOutboundRepo() {
  const { OutboundInvoiceRepository } =
    await import("../repos/outbound-invoice.repo");
  return new OutboundInvoiceRepository();
}

/**
 * Called at the end of every successful job step.
 * Merges step output into context and schedules the next step,
 * or marks the chain complete if this was the last step.
 */
export async function chainNext(
  job: Job<JobChainData>,
  stepOutput: Partial<JobChainData["context"]>,
): Promise<void> {
  const data = job.attrs.data;
  const nextIndex = data.stepIndex + 1;

  // Merge step output into the shared context
  const updatedContext = { ...data.context, ...stepOutput };

  if (nextIndex >= data.actions.length) {
    // ── Chain complete ─────────────────────────────────────────────────────
    logger.info("[Job] Chain complete", {
      jobChainId: data.jobChainId,
      tenantId: data.tenantId,
      steps: data.actions,
    });

    const irn = data.context?.irn;
    if (irn) {
      const outboundRepo = await getOutboundRepo();
      const invoice = await outboundRepo.findByIrn(irn).catch(() => null);
      if (invoice && invoice.workflowState?.delivered) {
        await outboundRepo.updateStatus(irn, OutboundInvoiceStatus.DELIVERED);
      }
    }

    if (data.webhookEventId) {
      try {
        await webhookEventRepo.markAsDelivered(data.webhookEventId, 200, {
          jobChainId: data.jobChainId,
          completedAt: new Date().toISOString(),
          finalContext: updatedContext,
        });
      } catch (err: any) {
        logger.warn("[chainNext] Could not mark webhook event as delivered", {
          webhookEventId: data.webhookEventId,
          error: err?.message,
        });
      }
    }

    return;
  }

  // ── Schedule next step ────────────────────────────────────────────────────
  const nextAction = data.actions[nextIndex];
  const nextJobName = ACTION_TO_JOB[nextAction];

  if (!nextJobName) {
    logger.warn("[Job] Unknown action — skipping", {
      nextAction,
      jobChainId: data.jobChainId,
    });
    return;
  }

  const nextData: JobChainData = {
    ...data,
    stepIndex: nextIndex,
    context: updatedContext,
  };

  const nextJob = await agenda.now(nextJobName, nextData);

  // Track the new Agenda job ID on the webhook event for chain tracing
  const nextAgendaJobId = nextJob.attrs._id?.toString();
  if (nextAgendaJobId) {
    webhookEventRepo.addJobId(data.webhookEventId, nextAgendaJobId);
  }

  logger.info("[Job] Scheduled next step", {
    jobChainId: data.jobChainId,
    step: nextIndex,
    action: nextAction,
    jobName: nextJobName,
  });
}

/**
 * Called when a job step fails.
 * - Appends a structured error entry to WebhookEvent.jobErrors
 * - Records the last failure on the OutboundInvoice (best-effort)
 * - Marks the webhook event as FAILED and stops the chain
 */
/**
 * Extract a comprehensive, descriptive error message from any error shape
 */
export function formatJobError(error: any): string {
  if (!error) return "Unknown error occurred";
  if (typeof error === "string") return error;

  const parts: string[] = [];

  const mainMessage = error?.message;
  if (
    mainMessage &&
    mainMessage !== "AppError" &&
    mainMessage !== "Error" &&
    !mainMessage.startsWith("Request failed with status code")
  ) {
    parts.push(mainMessage);
  }

  const data =
    error?.response?.data ||
    error?.data ||
    error?.errors?.response ||
    error?.errors;

  if (data) {
    if (typeof data === "string" && !parts.includes(data)) {
      parts.push(data);
    } else if (typeof data === "object") {
      const errorObj = data.error || data;
      const publicMsg = errorObj.public_message || data.public_message;
      const details = errorObj.details || data.details;
      const msg = errorObj.message || data.message;
      const errList = data.errors || errorObj.errors;

      if (publicMsg && !parts.includes(publicMsg)) {
        parts.push(publicMsg);
      }
      if (details) {
        const detailStr =
          typeof details === "string" ? details : JSON.stringify(details);
        if (!parts.includes(detailStr)) parts.push(detailStr);
      }
      if (msg && !parts.includes(msg)) {
        parts.push(msg);
      }
      if (Array.isArray(errList) && errList.length > 0) {
        const listStr = errList
          .map((e: any) =>
            typeof e === "string"
              ? e
              : e?.message ||
                (e?.field ? `${e.field}: ${e.message}` : JSON.stringify(e)),
          )
          .join("; ");
        if (!parts.includes(listStr)) parts.push(listStr);
      }
    }
  }

  if (
    error?.details &&
    typeof error.details === "string" &&
    !parts.includes(error.details)
  ) {
    parts.push(error.details);
  }

  if (parts.length > 0) {
    return parts.join(" — ");
  }

  return error?.message || String(error) || "Unknown job failure";
}

/**
 * Called when a job step fails.
 * - Appends a structured error entry to WebhookEvent.jobErrors
 * - Records the last failure on the OutboundInvoice (best-effort)
 * - Marks the webhook event as FAILED and stops the chain
 */
export async function chainFail(
  job: Job<JobChainData>,
  error: Error | any,
): Promise<void> {
  const data = job.attrs.data;
  const action = data.actions[data.stepIndex];
  const errorMessage = formatJobError(error);

  logger.error("[Job] Step failed — chain halted", {
    jobChainId: data.jobChainId,
    step: data.stepIndex,
    action,
    error: errorMessage,
  });

  // Append structured job error to the webhook event
  await webhookEventRepo.appendJobError(data.webhookEventId, {
    step: data.stepIndex,
    action,
    jobChainId: data.jobChainId,
    agendaJobId: job.attrs._id?.toString(),
    error: errorMessage,
    failedAt: new Date(),
  });

  // Record the last failure on the invoice (best-effort — do not block)
  const irn = data.context?.irn;
  if (irn) {
    const outboundRepo = await getOutboundRepo();
    await outboundRepo.setLastJobError(irn, action, errorMessage);
    await outboundRepo.updateStatus(irn, OutboundInvoiceStatus.FAILED);
  }

  if (data.webhookEventId) {
    try {
      await webhookEventRepo.markAsFailed(
        data.webhookEventId,
        `Step [${action}] failed: ${errorMessage}`,
        500,
      );
    } catch (err: any) {
      logger.warn("[chainFail] Could not mark webhook event as failed", {
        webhookEventId: data.webhookEventId,
        error: err?.message,
      });
    }
  }
}
