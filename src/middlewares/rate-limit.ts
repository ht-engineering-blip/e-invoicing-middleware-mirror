import { Elysia } from "elysia";
import { TenantRepository } from "../v1/tenants/repos/tenant.repo";
import { TIME_MS } from "../@lib/constants";

// Map storing client requests: key (tenantId or IP) -> array of timestamps (ms)
const requestLogs = new Map<string, number[]>();

// Cache for tenant rate limits to prevent DB overhead: tenantId -> { limit, expiresAt }
const limitCache = new Map<string, { limit: number; expiresAt: number }>();
const CACHE_TTL = TIME_MS.FIVE_MINUTES;
const DEFAULT_TENANT_LIMIT = 100; // requests per minute
const DEFAULT_IP_LIMIT = 60; // requests per minute
const WINDOW_MS = TIME_MS.ONE_MINUTE;

// Periodic cleanup of inactive client logs every 5 minutes
const cleanupInterval = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, timestamps] of requestLogs.entries()) {
    const valid = timestamps.filter((ts) => ts > cutoff);
    if (valid.length === 0) {
      requestLogs.delete(key);
    } else if (valid.length !== timestamps.length) {
      requestLogs.set(key, valid);
    }
  }
}, TIME_MS.FIVE_MINUTES);

// Export interval ref for testing/cleanup purposes if needed
if (cleanupInterval && typeof cleanupInterval.unref === "function") {
  cleanupInterval.unref();
}

async function getTenantRateLimit(tenantId: string): Promise<number> {
  const now = Date.now();
  const cached = limitCache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    return cached.limit;
  }

  try {
    const tenantRepo = new TenantRepository();
    const tenant = await tenantRepo.findByTenantId(tenantId);
    const limit = tenant?.config?.limits?.apiRateLimit ?? DEFAULT_TENANT_LIMIT;
    limitCache.set(tenantId, {
      limit,
      expiresAt: now + CACHE_TTL,
    });
    return limit;
  } catch (error) {
    console.error("Error resolving rate limit for tenant %s:", tenantId, error);
    return DEFAULT_TENANT_LIMIT;
  }
}

function getClientIp(
  request: Request,
  headers: Record<string, string | undefined>,
): string {
  const forwardedFor = headers["x-forwarded-for"];
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = headers["x-real-ip"];
  if (realIp) {
    return realIp;
  }
  return "unknown-ip";
}

export const rateLimitMiddleware = (app: Elysia) =>
  app.onBeforeHandle(async ({ auth, headers, request, set }: any) => {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    // 1. Identify client
    let identifier = "";
    let limit = DEFAULT_IP_LIMIT;
    let isTenant = false;

    if (auth?.tenantId) {
      identifier = `tenant:${auth.tenantId}`;
      isTenant = true;
    } else if (headers && headers["x-tenant-id"]) {
      identifier = `tenant:${headers["x-tenant-id"]}`;
      isTenant = true;
    } else {
      const ip = getClientIp(request, headers || {});
      identifier = `ip:${ip}`;
    }

    // 2. Resolve limit
    if (isTenant) {
      const tenantId = identifier.split(":")[1];
      limit = await getTenantRateLimit(tenantId);
    }

    // 3. Evaluate rate limit
    let timestamps = requestLogs.get(identifier) || [];
    timestamps = timestamps.filter((ts) => ts > cutoff);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] || cutoff;
      const resetTime = oldest + WINDOW_MS;
      const retryAfter = Math.max(1, Math.ceil((resetTime - now) / 1000));

      set.status = 429;
      set.headers["X-RateLimit-Limit"] = String(limit);
      set.headers["X-RateLimit-Remaining"] = "0";
      set.headers["X-RateLimit-Reset"] = String(Math.ceil(resetTime / 1000));
      set.headers["Retry-After"] = String(retryAfter);

      return {
        success: false,
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please try again later.",
      };
    }

    // Record request
    timestamps.push(now);
    requestLogs.set(identifier, timestamps);

    // Set success rate limit headers
    const oldest = timestamps[0] || now;
    const resetTime = oldest + WINDOW_MS;
    set.headers["X-RateLimit-Limit"] = String(limit);
    set.headers["X-RateLimit-Remaining"] = String(limit - timestamps.length);
    set.headers["X-RateLimit-Reset"] = String(Math.ceil(resetTime / 1000));
  });
