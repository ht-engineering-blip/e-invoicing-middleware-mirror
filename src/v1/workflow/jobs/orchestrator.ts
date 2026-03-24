import crypto from 'crypto';
import { agenda } from '../../../@lib/queue/agenda';
import { ACTION_TO_JOB, getPriority, type JobChainData } from './types';
import { TenantRepository } from '../../tenants/repos/tenant.repo';
import { WebhookEventRepository } from '../../webhook/repos/webhook-event.repo';
import { logger } from '../../../@lib/logger';
import { decryptSensitiveData } from '../../../@lib/crypto';

const webhookEventRepo = new WebhookEventRepository();

const tenantRepo = new TenantRepository();

export interface ScheduleChainInput {
  webhookEventId: string;
  tenantId: string;
  eventType: string;
  payload: any;
  actions: string[];
  routeId?: string;
  priority?: number;
  /** ERP invoice identifier extracted from the webhook payload */
  erpInvoiceId?: string;
  /** Pre-generated IRN from the webhook handler (avoids duplicate generation) */
  irn?: string;
}

/**
 * Builds and enqueues the first job of a processing chain.
 * Called from the inbound webhook handler after event routing is resolved.
 * The remaining steps are scheduled automatically by each job via chain.ts.
 */
export async function scheduleJobChain(input: ScheduleChainInput): Promise<string> {
  const { webhookEventId, tenantId, eventType, payload, actions, routeId } = input;
   let decryptedClientID: any;
  if (!actions.length) {
    logger.warn('[Orchestrator] No actions to schedule', { webhookEventId, tenantId, eventType });
    return '';
  }

  // Validate all action IDs are known
  const unknownActions = actions.filter((a) => !ACTION_TO_JOB[a]);
  if (unknownActions.length) {
    logger.warn('[Orchestrator] Unknown actions — skipping chain', { unknownActions });
    return '';
  }

  // Build auth context from tenant
  const tenant = await tenantRepo.findOne({ tenantId: { _eq: tenantId } });

  // Decrypt Business ID
  if (tenant && tenant.config && tenant.config.firsCredentials?.clientId) {
     decryptedClientID = decryptSensitiveData(tenant.config.firsCredentials.clientId)
     // (tenant as any).businessId = decryptedClientID
  }
  const authContext: JobChainData['authContext'] = {
    tenantId,
    businessId: decryptedClientID ?? (tenant as any)?.businessId,
    businessTIN: tenant?.tin,
    serviceId: tenant?.config?.firsCredentials?.serviceId,
    tenantERP: tenant?.config?.erpSystem,
    isAdmin: false,
  };

  const jobChainId = crypto.randomUUID();
  const priority = input.priority ?? getPriority(eventType);

  const firstAction = actions[0];
  const firstJobName = ACTION_TO_JOB[firstAction];

  const data: JobChainData = {
    jobChainId,
    webhookEventId,
    tenantId,
    eventType,
    actions,
    stepIndex: 0,
    authContext,
    context: {
      originalPayload: payload,
      sourceType: payload?.sourceType ?? tenant?.config?.erpSystem,
      irn: input.irn,
      erpInvoiceId: input.erpInvoiceId,
    },
    priority,
    routeId,
  };

  const job = await agenda.now(firstJobName, data);
  // Set priority after scheduling (Agenda stores it on the attrs)
  job.priority(priority);
  await job.save();

  // Track the first Agenda job ID on the webhook event for chain tracing
  const agendaJobId = job.attrs._id?.toString();
  if (agendaJobId) {
    webhookEventRepo.addJobId(webhookEventId, agendaJobId).catch(() => {});
  }

  logger.info('[Orchestrator] Chain scheduled', {
    jobChainId,
    tenantId,
    eventType,
    actions,
    firstJob: firstJobName,
    priority,
  });

  return jobChainId;
}
