/**
 * Worker-side: count invoices submitted when a pipeline chain starts.
 * NRS acceptance is recorded separately on successful chain completion.
 */
import type { Job } from "agenda";
import { agenda } from "../../../@lib/queue/agenda";
import {
  isInvoicePipeline,
  recordInvoiceSubmitted,
} from "../../../@lib/metrics";
import { logger } from "../../../@lib/logger";

/** Avoid double-counting if Agenda retries the first step of the same chain. */
const recordedChainIds = new Set<string>();
const MAX_TRACKED_CHAINS = 10_000;

export function registerInvoiceIntakeMetrics(): void {
  agenda.on("start", (job: Job) => {
    try {
      const data = job.attrs?.data as JobChainData | undefined;
      if (!data?.jobChainId || data.stepIndex !== 0) return;
      if (!isInvoicePipeline(data.actions)) return;
      if (recordedChainIds.has(data.jobChainId)) return;

      if (recordedChainIds.size >= MAX_TRACKED_CHAINS) {
        recordedChainIds.clear();
      }
      recordedChainIds.add(data.jobChainId);

      if (!data.context) {
        data.context = { originalPayload: undefined };
      }
      if (!data.context.metricsStartedAt) {
        data.context.metricsStartedAt = Date.now();
      }

      const erpSystem =
        data.context.erpSystem ??
        data.context.sourceType ??
        data.authContext?.tenantERP;
      const source =
        typeof data.context.source === "string"
          ? data.context.source
          : data.context.source != null
            ? String(data.context.source)
            : "unknown";

      recordInvoiceSubmitted({
        tenantId: data.tenantId,
        source,
        eventType: data.eventType,
        erpSystem,
      });
    } catch (err: any) {
      logger.warn("[Metrics] Failed to record invoice submit", {
        error: err?.message,
      });
    }
  });
}
