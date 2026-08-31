import type { Job } from "agenda";
import Handlebars from "handlebars";
import { agenda } from "../../../../@lib/queue/agenda";
import { logger } from "../../../../@lib/logger";
import { chainNext, chainFail } from "../chain";
import { TenantService } from "../../../tenants/services/tenant.service";
import type { IERPSyncConfig } from "../../../tenants/models/tenant.model";
import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import type { InvoiceType } from "../../../../@lib/adapters/firs/types";
import { buildQrUrl, isSafeUrl } from "../../../../@lib";

const tenantService = new TenantService();
const firsService = new FIRSService();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build Authorization / auth headers from the decrypted erpSyncConfig.authentication block.
 */
function buildAuthHeaders(
  auth: IERPSyncConfig["authentication"],
): Record<string, string> {
  if (!auth || auth.type === "none") return {};
  //logger.info("AUTH::",{auth})
  switch (auth.type) {
    case "bearer":
      return { Authorization: `Bearer ${auth.token}` };

    case "basic": {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString(
        "base64",
      );
      return { Authorization: `Basic ${encoded}` };
    }

    case "api-key":
      if (
        auth.apiKeyLocation === "header" &&
        auth.apiKeyName &&
        auth.apiKeyValue
      ) {
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
function applyQueryAuth(
  url: string,
  auth: IERPSyncConfig["authentication"],
): string {
  if (
    auth?.type === "api-key" &&
    auth.apiKeyLocation === "query" &&
    auth.apiKeyName &&
    auth.apiKeyValue
  ) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${encodeURIComponent(auth.apiKeyName)}=${encodeURIComponent(auth.apiKeyValue)}`;
  }
  return url;
}

/**
 * Apply static queryParams from config to the URL.
 */
function applyQueryParams(
  url: string,
  queryParams?: Record<string, string> | Map<string, string> | any,
): string {
  if (!queryParams) return url;

  let entries: [string, string][] = [];

  if (
    queryParams instanceof Map ||
    (typeof queryParams.entries === "function" &&
      typeof queryParams.get === "function")
  ) {
    entries = Array.from(queryParams.entries());
  } else if (typeof queryParams === "object") {
    // Safely exclude internal Mongoose properties like $__parent, $__path
    entries = Object.entries(queryParams).filter(
      ([k]) => !k.startsWith("$__"),
    ) as [string, string][];
  }

  if (entries.length === 0) return url;

  const sep = url.includes("?") ? "&" : "?";
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${url}${sep}${qs}`;
}

const templateCache = new Map<string, HandlebarsTemplateDelegate>();

/**
 * Compile and render a Handlebars bodyTemplate with delegate caching
 * Returns undefined when no template is configured (e.g. GET requests).
 */
function renderBody(
  bodyTemplate: string | undefined,
  data: any,
): string | undefined {
  if (!bodyTemplate) return undefined;
  try {
    let compiled = templateCache.get(bodyTemplate);
    if (!compiled) {
      compiled = Handlebars.compile(bodyTemplate, { noEscape: true });
      if (templateCache.size < 200) {
        templateCache.set(bodyTemplate, compiled);
      }
    }
    return compiled(data);
  } catch (err: any) {
    throw new Error(`ERP sync bodyTemplate render failed: ${err.message}`);
  }
}

/**
 * Resolves the FIRS invoice type code from the invoice-types resource list
 * based on the event type or explicit invoice type code.
 */
export function resolveInvoiceTypeCode(
  eventType: string,
  invoiceTypes: InvoiceType[] = [],
  explicitCode?: string,
): string {
  // 1. Direct code lookup if already present on the invoice
  if (explicitCode) {
    const directMatch = invoiceTypes.find(
      (t) => (t.key || t.code) === explicitCode,
    );
    if (directMatch) return String(directMatch.key || directMatch.code);
  }

  // 2. Normalize strings for fuzzy matching
  const sanitize = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedTarget = sanitize(eventType);

  // 3. Match against FIRS invoice-types resource
  for (const item of invoiceTypes) {
    const key = String(item.key || item.code || "");
    const value = item.value || item.description || "";
    const normalizedValue = sanitize(value);

    if (!key || !normalizedValue) continue;

    // Full or substring match (e.g. "erp.creditnote.issued" contains "creditnote")
    if (
      normalizedTarget.includes(normalizedValue) ||
      normalizedValue.includes(normalizedTarget)
    ) {
      return key;
    }

    // Significant keyword match (words with 4+ chars like "credit", "debit", "factor", "statement")
    const keywords = value
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .map(sanitize);

    if (
      keywords.length > 0 &&
      keywords.every((kw) => normalizedTarget.includes(kw))
    ) {
      return key;
    }
  }

  // 4. Fallback defaults if resource is empty or no match
  if (normalizedTarget.includes("credit")) return "380";
  if (normalizedTarget.includes("debit")) return "384";
  if (normalizedTarget.includes("self") && normalizedTarget.includes("bill")) {
    return "385";
  }
  if (normalizedTarget.includes("factor")) return "388";
  if (normalizedTarget.includes("statement")) return "389";
  return explicitCode ?? "381";
}

// ── Job definition ────────────────────────────────────────────────────────────

export function registerSyncErpJob(): void {
  agenda.define("workflow:sync-erp", async (job: Job<JobChainData>) => {
    const { tenantId, context, jobChainId, eventType } = job.attrs.data;

    logger.info("[Job:sync-erp] Starting", { jobChainId, tenantId });

    try {
      // Load and decrypt ERP sync config
      const erpSyncConfig = await tenantService.getERPSyncConfig(tenantId);

      if (!erpSyncConfig) {
        throw new Error(`No ERP sync config found for tenant ${tenantId}`);
      }

      if (!erpSyncConfig.enabled) {
        logger.info(
          "[Job:sync-erp] ERP sync is disabled for tenant — skipping",
          {
            tenantId,
          },
        );
        // Skip gracefully without failing the chain
        await chainNext(job, {
          erpSyncResult: { skipped: true, reason: "disabled" },
        });
        return;
      }

      // Build URL
      let url = `${erpSyncConfig.baseUrl.replace(/\/$/, "")}/${erpSyncConfig.endpoint.replace(/^\//, "")}`;
      url = applyQueryParams(url, erpSyncConfig.queryParams);
      url = applyQueryAuth(url, erpSyncConfig.authentication);

      // SSRF URL Validation
      if (!(await isSafeUrl(url))) {
        throw new Error(
          `Outbound request to URL is blocked by SSRF guard: ${url}`,
        );
      }

      logger.info("[Job:sync-erp] Outbound request", { url });

      // Build headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(erpSyncConfig.headers ?? {}),
        ...buildAuthHeaders(erpSyncConfig.authentication),
      };

      // Render body from Handlebars template using the full job context as data
      let qrCode = context.qrCode;
      if (context.qrCode && context.qrCode.indexOf("data:image/") > -1) {
        qrCode = buildQrUrl(context.irn, !!qrCode) as string;
      }

      // Dynamically fetch invoice-types from FIRS (GET /api/v1/invoice/resources/invoice-types)
      let invoiceTypes: InvoiceType[] = [];
      try {
        invoiceTypes =
          await firsService.getResource<InvoiceType>("invoice-types");
      } catch (err: any) {
        logger.warn("[Job:sync-erp] Failed to fetch invoice-types from FIRS", {
          error: err.message,
        });
      }

      const explicitCode =
        context.transformedInvoice?.invoice_type_code ??
        context.transformedInvoice?.invoiceTypeCode;

      const invoiceType = resolveInvoiceTypeCode(
        eventType,
        invoiceTypes,
        explicitCode,
      );

      // Whitelist Handlebars data model to prevent prototype pollution and unauthorized context leakage
      const templateData: Record<string, unknown> = {
        tenantId,
        jobChainId,
        eventType,
        irn: context.irn,
        qrCode,
        invoiceType,
        invoice_type: invoiceType,
        erpInvoiceId: context.erpInvoiceId,
        sourceType: context.sourceType,
        source: context.source,
        transformedInvoice: context.transformedInvoice,
        validationResult: context.validationResult,
        signedInvoice: context.signedInvoice,
        firsResponse: context.firsResponse,
        originalPayload: context.originalPayload,
        payload: context.payload,
        customFields: context.customFields,
      };

      const renderedBody = renderBody(erpSyncConfig.bodyTemplate, templateData);

      // Execute request with configurable timeout and redirect: 'error' (maxRedirects: 0)
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
          redirect: "error",
        });
      } finally {
        clearTimeout(timer);
      }

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `ERP sync request failed: ${response.status} ${response.statusText} — ${responseText}`,
        );
      }

      logger.info("[Job:sync-erp] Done", {
        jobChainId,
        tenantId,
        status: response.status,
      });

      // Strip raw ERP response from propagating through the chain to avoid sensitive data leakage
      await chainNext(job, {
        erpSyncResult: {
          status: response.status,
          success: true,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.error(err);
      await chainFail(job, err);
      throw err;
    }
  });
}
