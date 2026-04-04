import type { Job } from 'agenda';
import Handlebars from 'handlebars';
import { agenda } from '../../../../@lib/queue/agenda';
import { logger } from '../../../../@lib/logger';
import { chainNext, chainFail } from '../chain';
import type { JobChainData } from '../types';
import { TenantService } from '../../../tenants/services/tenant.service';
import type { IERPSyncConfig } from '../../../tenants/models/tenant.model';

const tenantService = new TenantService();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build Authorization / auth headers from the decrypted erpSyncConfig.authentication block.
 */
function buildAuthHeaders(auth: IERPSyncConfig['authentication']): Record<string, string> {
  if (!auth || auth.type === 'none') return {};
//logger.info("AUTH::",{auth})
  switch (auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${auth.token}` };

    case 'basic': {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      return { Authorization: `Basic ${encoded}` };
    }

    case 'api-key':
      if (auth.apiKeyLocation === 'header' && auth.apiKeyName && auth.apiKeyValue) {
        return { [auth.apiKeyName]: auth.apiKeyValue };
      }
      return {};

    default:
      return {};
  }
}

/**
 * Append api-key query params to a URL when apiKeyLocation === 'query'.
 */
function applyQueryAuth(url: string, auth: IERPSyncConfig['authentication']): string {
  if (
    auth?.type === 'api-key' &&
    auth.apiKeyLocation === 'query' &&
    auth.apiKeyName &&
    auth.apiKeyValue
  ) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${encodeURIComponent(auth.apiKeyName)}=${encodeURIComponent(auth.apiKeyValue)}`;
  }
  return url;
}

/**
 * Apply static queryParams from config to the URL.
 */
function applyQueryParams(url: string, queryParams?: Record<string, string>): string {
  if (!queryParams || Object.keys(queryParams).length === 0) return url;
  const sep = url.includes('?') ? '&' : '?';
  const qs = Object.entries(queryParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${url}${sep}${qs}`;
}

/**
 * Compile and render a Handlebars bodyTemplate using the job context as the data model.
 * Returns undefined when no template is configured (e.g. GET requests).
 */
function renderBody(bodyTemplate: string | undefined, data: any): string | undefined {
  if (!bodyTemplate) return undefined;
  try {
    const compiled = Handlebars.compile(bodyTemplate, { noEscape: true });
    return compiled(data);
  } catch (err: any) {
    throw new Error(`ERP sync bodyTemplate render failed: ${err.message}`);
  }
}

/**
 * Map ERP response fields back into an object using responseMapping.
 * responseMapping: { "localKey": "response.path.to.value" }
 */
function applyResponseMapping(
  response: any,
  responseMapping?: Record<string, string>
): Record<string, any> {
  if (!responseMapping) return {};
  const result: Record<string, any> = {};
  for (const [localKey, responsePath] of Object.entries(responseMapping)) {
    const value = responsePath
      .split('.')
      .reduce((acc: any, seg) => (acc != null ? acc[seg] : undefined), response);
    if (value !== undefined) result[localKey] = value;
  }
  return result;
}

// ── Job definition ────────────────────────────────────────────────────────────

export function registerSyncErpJob(): void {
  agenda.define(
    'workflow:sync-erp',
    async (job: Job<JobChainData>) => {
      const { tenantId, context, jobChainId } = job.attrs.data;

      logger.info('[Job:sync-erp] Starting', { jobChainId, tenantId });

      // Load and decrypt ERP sync config
      const erpSyncConfig = await tenantService.getERPSyncConfig(tenantId);

      if (!erpSyncConfig) {
        const err = new Error(`No ERP sync config found for tenant ${tenantId}`);
        await chainFail(job, err);
        throw err;
      }

      if (!erpSyncConfig.enabled) {
        logger.info('[Job:sync-erp] ERP sync is disabled for tenant — skipping', { tenantId });
        // Skip gracefully without failing the chain
        await chainNext(job, { erpSyncResult: { skipped: true, reason: 'disabled' } });
        return;
      }

      try {
        // Build URL
        let url = `${erpSyncConfig.baseUrl.replace(/\/$/, '')}/${erpSyncConfig.endpoint.replace(/^\//, '')}`;
         logger.info("URL::", {url, erpSyncConfig})
        url = applyQueryParams(url, erpSyncConfig.queryParams);
        url = applyQueryAuth(url, erpSyncConfig.authentication);

       //console.log(JSON.stringify(Object.assign({}, erpSyncConfig.headers)) )
        // Build headers
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(JSON.parse(JSON.stringify(erpSyncConfig.headers ?? {}))),
          ...buildAuthHeaders(erpSyncConfig.authentication),
        };

        logger.debug("headers::", headers)
        // Render body from Handlebars template using the full job context as data
        const renderedBody = renderBody(erpSyncConfig.bodyTemplate, {
          ...context,
          tenantId,
          jobChainId,
        });

        // Execute request with configurable timeout
        const controller = new AbortController();
        const timeoutMs = erpSyncConfig.timeout ?? 30_000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let response: Response;
        try {
          response = await fetch(url, {
            method: erpSyncConfig.method,
            headers,
            body: renderedBody ?? undefined,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        const responseText = await response.text();
        let responseData: any;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = responseText;
        }

        if (!response.ok) {
          throw new Error(
            `ERP sync request failed: ${response.status} ${response.statusText} — ${responseText}`
          );
        }

        // Map response fields back into chain context
       // const mappedFields = applyResponseMapping(responseData, erpSyncConfig.responseMapping);

        logger.info('[Job:sync-erp] Done', {
          jobChainId,
          tenantId,
          status: response.status,
          mappedKeys: Object.keys(responseData),
        });

        await chainNext(job, {
          erpSyncResult: {
            status: response.status,
            data: responseData
          },
        });

      } catch (err: any) {
        logger.error(err)
        await chainFail(job, err);
        throw err;
      }
    }
  );
}
