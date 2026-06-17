import type { Job } from 'agenda';
import { agenda } from '../../../@lib/queue/agenda';
import { logger } from '../../../@lib/logger';
import { WebhookEventRepository } from '../../webhook/repos/webhook-event.repo';
import { ACTION_TO_JOB } from './types';
import { OutboundInvoiceStatus } from '../models/outbound-invoice.model';

const webhookEventRepo = new WebhookEventRepository();

// Lazy-loaded to avoid circular dependency at module load time
async function getOutboundRepo() {
  const { OutboundInvoiceRepository } = await import('../repos/outbound-invoice.repo');
  return new OutboundInvoiceRepository();
}

/**
 * Called at the end of every successful job step.
 * Merges step output into context and schedules the next step,
 * or marks the chain complete if this was the last step.
 */
export async function chainNext(
  job: Job<JobChainData>,
  stepOutput: Partial<JobChainData['context']>
): Promise<void> {
  const data = job.attrs.data;
  const nextIndex = data.stepIndex + 1;

  // Merge step output into the shared context
  const updatedContext = { ...data.context, ...stepOutput };

  if (nextIndex >= data.actions.length) {
    // ── Chain complete ─────────────────────────────────────────────────────
    logger.info('[Job] Chain complete', {
      jobChainId: data.jobChainId,
      tenantId: data.tenantId,
      steps: data.actions,
    });

    const irn = data.context?.irn;
    if (irn) {
      const outboundRepo = await getOutboundRepo();
      const invoice = await outboundRepo.findByIrn(irn).catch(() => null);
      if (invoice && invoice.workflowState?.delivered) {
        await outboundRepo.updateStatus(irn, OutboundInvoiceStatus.DELIVERED).catch(() => {});
      }
    }

    await webhookEventRepo.markAsDelivered(data.webhookEventId, 200, {
      jobChainId: data.jobChainId,
      completedAt: new Date().toISOString(),
      finalContext: updatedContext,
    });

    return;
  }

  // ── Schedule next step ────────────────────────────────────────────────────
  const nextAction = data.actions[nextIndex];
  const nextJobName = ACTION_TO_JOB[nextAction];

  if (!nextJobName) {
    logger.warn('[Job] Unknown action — skipping', { nextAction, jobChainId: data.jobChainId });
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
    webhookEventRepo.addJobId(data.webhookEventId, nextAgendaJobId).catch(() => { });
  }

  logger.info('[Job] Scheduled next step', {
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
export async function chainFail(
  job: Job<JobChainData>,
  error: Error
): Promise<void> {
  const data = job.attrs.data;
  const action = data.actions[data.stepIndex];

  error.message = error.message.indexOf('undefined -') > -1 ? "Something went wrong,  Please retry from failed step." : error.message

  logger.error('[Job] Step failed — chain halted', {
    jobChainId: data.jobChainId,
    step: data.stepIndex,
    action,
    error: error.message,
  });

  // Append structured job error to the webhook event
  await webhookEventRepo.appendJobError(data.webhookEventId, {
    step: data.stepIndex,
    action,
    jobChainId: data.jobChainId,
    agendaJobId: job.attrs._id?.toString(),
    error: error.message,
    failedAt: new Date(),
  });

  // Record the last failure on the invoice (best-effort — do not block)
  const irn = data.context?.irn;
  if (irn) {
    const outboundRepo = await getOutboundRepo();
    await outboundRepo.setLastJobError(irn, action, error.message);
    await outboundRepo.updateStatus(irn, OutboundInvoiceStatus.FAILED).catch(() => {});
  }

  await webhookEventRepo.markAsFailed(
    data.webhookEventId,
    `Step [${action}] failed: ${error.message.indexOf('undefined -') > -1 ? "" : error.message}`,
    500
  );
}
