import { client, metricsRegistry } from './registry';

/**
 * Pipeline / NRS step metrics (worker Agenda jobs).
 * Covers transform → validate → sign → transmit etc. even when no HTTP call is made.
 */
export const pipelineStepTotal = new client.Counter({
  name: 'einvoice_pipeline_step_total',
  help: 'Invoice pipeline / NRS step outcomes on the worker',
  labelNames: ['step', 'result', 'erp_system'] as const,
  registers: [metricsRegistry],
});

export const pipelineStepDurationSeconds = new client.Histogram({
  name: 'einvoice_pipeline_step_duration_seconds',
  help: 'Duration of a single pipeline step on the worker',
  labelNames: ['step', 'result', 'erp_system'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [metricsRegistry],
});

function normalizeErp(erp?: string): string {
  const value = (erp || 'unknown').trim();
  return value.length ? value : 'unknown';
}

export function recordPipelineStep(labels: {
  step: string;
  result: 'success' | 'failure';
  erpSystem?: string;
  durationSeconds?: number;
}): void {
  try {
    const step = labels.step || 'unknown';
    const result = labels.result;
    const erp_system = normalizeErp(labels.erpSystem);

    pipelineStepTotal.inc({ step, result, erp_system });

    if (
      typeof labels.durationSeconds === 'number' &&
      labels.durationSeconds >= 0
    ) {
      pipelineStepDurationSeconds.observe(
        { step, result, erp_system },
        labels.durationSeconds
      );
    }
  } catch {
    // never break jobs
  }
}
