import crypto from "crypto";
import { EventEmitter } from "events";
import { WebhookNonceRepository } from "../repos/webhook-nonce.repo";
import { isWebhookExpired } from "./webhook-lifespan.helper";

const webhookNonceRepo = new WebhookNonceRepository();

/**
 * In-memory event bus for real-time SSE streaming per webhook path.
 */
export const webhookBus = new EventEmitter();
webhookBus.setMaxListeners(0);

/**
 * Signs the webhook payload using the HMAC-SHA256 scheme.
 */
export function signWebhookPayload(
  secret: string,
  timestamp: string | number,
  payload: string,
): string {
  const dataToSign = `${timestamp}.${payload}`;
  return crypto.createHmac("sha256", secret).update(dataToSign).digest("hex");
}

/**
 * Timing-safe string comparison.
 */
export function safeCompareSecret(provided: string, expected: string): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }
  const bufA = Buffer.from(provided);
  const bufB = Buffer.from(expected);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface VerifyWebhookParams {
  headers: Record<string, string | undefined>;
  rawBody: string;
  tenant: {
    tenantId: string;
    config?: {
      webhookAuth?: string;
      webhookExpiresAt?: Date;
      webhookLifespan?: string;
      webhookAuthMode?: "auto" | "hmac" | "static_secret" | "secret_url" | string;
      defaultEventType?: string;
    };
    metadata?: {
      webhookSecretHash?: string;
      webhookExpiresAt?: Date;
      webhookLifespan?: string;
      webhookAuthMode?: string;
    };
  };
  query?: Record<string, string | undefined>;
  bodyObj?: Record<string, unknown>;
  nonceRepo?: {
    findOne: (query: { tenantId: string; t: number; v1: string }) => Promise<any>;
    create: (data: { tenantId: string; t: number; v1: string }) => Promise<any>;
  };
}

/**
 * Verifies the inbound webhook using Multi-Strategy Authentication:
 * 1. HMAC-SHA256 (X-Webhook-Key: t=...,v1=...)
 * 2. Static Secret Header (X-Webhook-Secret, X-Api-Key, Authorization: Bearer <secret>)
 * 3. Static Query Parameter (?secret=..., ?token=..., ?key=...)
 * 4. Payload Body Secret (body.secret, body.webhook_secret, body.token)
 * 5. Secret URL Capability (if authMode === "secret_url")
 */
export async function verifyWebhookSignature({
  headers,
  rawBody,
  tenant,
  query,
  bodyObj,
  nonceRepo,
}: VerifyWebhookParams): Promise<
  { success: true; authStrategy?: string } | { success: false; status: number; error: string }
> {
  const secret = tenant.config?.webhookAuth;
  const webhookKeyHash = tenant.metadata?.webhookSecretHash;
  const effectiveNonceRepo = nonceRepo || webhookNonceRepo;

  // If no secret hash or secret is configured, allow for legacy/unconfigured support
  if (!secret && !webhookKeyHash) {
    return { success: true, authStrategy: "legacy_unconfigured" };
  }

  // Enforce lifespan / expiration verification
  const expiresAt =
    tenant.metadata?.webhookExpiresAt || tenant.config?.webhookExpiresAt;
  if (isWebhookExpired(expiresAt)) {
    return {
      success: false,
      status: 401,
      error:
        "Webhook credentials have expired. Please regenerate your webhook credentials.",
    };
  }

  const authMode =
    tenant.config?.webhookAuthMode ||
    tenant.metadata?.webhookAuthMode ||
    "auto";

  // Strategy 5: Secret URL Capability Mode
  if (authMode === "secret_url") {
    return { success: true, authStrategy: "secret_url" };
  }

  // Normalize lower-case header getters
  const getHeader = (key: string): string | undefined => {
    const direct = headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()];
    return typeof direct === "string" ? direct.trim() : undefined;
  };

  const webhookKey =
    getHeader("x-webhook-key") ||
    getHeader("x-webhook-signature") ||
    getHeader("x-signature");

  const staticHeader =
    getHeader("x-webhook-secret") ||
    getHeader("x-api-key") ||
    getHeader("x-auth-token") ||
    getHeader("x-token");

  const authHeader = getHeader("authorization");

  const querySecret =
    query?.secret ||
    query?.token ||
    query?.key ||
    query?.webhook_secret ||
    query?.apiKey;

  const bodySecret =
    bodyObj && typeof bodyObj === "object"
      ? (bodyObj.secret as string | undefined) ||
        (bodyObj.webhook_secret as string | undefined) ||
        (bodyObj.secretKey as string | undefined) ||
        (bodyObj.token as string | undefined) ||
        (bodyObj.apiKey as string | undefined)
      : undefined;

  /**
   * Helper to verify a candidate static secret against either the raw secret
   * or the legacy webhookSecretHash.
   */
  const checkSecretMatch = (candidate: string | undefined): boolean => {
    if (!candidate || typeof candidate !== "string") return false;
    const trimmed = candidate.trim();
    if (secret && safeCompareSecret(trimmed, secret)) {
      return true;
    }
    if (webhookKeyHash) {
      const candidateHash = crypto
        .createHash("sha256")
        .update(trimmed)
        .digest("hex");
      try {
        if (
          crypto.timingSafeEqual(
            Buffer.from(candidateHash, "hex"),
            Buffer.from(webhookKeyHash, "hex"),
          )
        ) {
          return true;
        }
      } catch {
        // buffer length mismatch or invalid hex
      }
    }
    return false;
  };

  // Verify HMAC-SHA256 Helper
  const verifyHmac = async (keyString: string) => {
    const isSecureFormat =
      keyString.includes("t=") && keyString.includes("v1=");

    if (!isSecureFormat) {
      return {
        success: false as const,
        status: 401,
        error:
          "Invalid X-Webhook-Key format. Requests must be signed with timestamp (t) and signature (v1)",
      };
    }

    const parts = keyString.split(",");
    let tStr = "";
    let v1 = "";
    for (const part of parts) {
      const [k, val] = part.split("=");
      if (k === "t") tStr = val;
      if (k === "v1") v1 = val;
    }

    if (!tStr || !v1) {
      return {
        success: false as const,
        status: 401,
        error: "Invalid X-Webhook-Key format (missing t or v1)",
      };
    }

    const t = parseInt(tStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(t) || Math.abs(now - t) > 300) {
      return {
        success: false as const,
        status: 401,
        error: "Webhook request expired or timestamp invalid",
      };
    }

    const isReplay = await effectiveNonceRepo.findOne({
      tenantId: tenant.tenantId,
      t,
      v1,
    });
    if (isReplay) {
      return {
        success: false as const,
        status: 401,
        error: "Duplicate webhook request detected (replay prevention)",
      };
    }

    if (!secret) {
      return {
        success: false as const,
        status: 401,
        error: "Webhook secret not configured for HMAC verification",
      };
    }

    const computedSignature = signWebhookPayload(secret, tStr, rawBody);
    let isValid = false;
    try {
      isValid = crypto.timingSafeEqual(
        Buffer.from(v1, "hex"),
        Buffer.from(computedSignature, "hex"),
      );
    } catch {
      isValid = false;
    }

    if (!isValid) {
      return {
        success: false as const,
        status: 401,
        error: "Invalid webhook signature",
      };
    }

    await effectiveNonceRepo.create({
      tenantId: tenant.tenantId,
      t,
      v1,
    });

    return { success: true as const, authStrategy: "hmac" };
  };

  // If authMode is strictly "hmac"
  if (authMode === "hmac") {
    if (!webhookKey) {
      return {
        success: false,
        status: 401,
        error: "Missing X-Webhook-Key header for HMAC authentication",
      };
    }
    return verifyHmac(webhookKey);
  }

  // If authMode is strictly "static_secret"
  if (authMode === "static_secret") {
    if (staticHeader && checkSecretMatch(staticHeader)) {
      return { success: true, authStrategy: "static_header" };
    }
    if (webhookKey && checkSecretMatch(webhookKey)) {
      return { success: true, authStrategy: "legacy_static_key" };
    }
    if (authHeader) {
      const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : authHeader.trim();
      if (checkSecretMatch(bearerToken)) {
        return { success: true, authStrategy: "bearer_token" };
      }
    }
    if (querySecret && checkSecretMatch(querySecret)) {
      return { success: true, authStrategy: "query_param" };
    }
    if (bodySecret && typeof bodySecret === "string" && checkSecretMatch(bodySecret)) {
      return { success: true, authStrategy: "body_secret" };
    }

    return {
      success: false,
      status: 401,
      error: "Invalid or missing static webhook secret",
    };
  }

  // Default "auto" mode: dynamically attempt all strategies

  // 1. Dynamic HMAC Signature (when timestamp & signature are present)
  if (webhookKey && webhookKey.includes("t=") && webhookKey.includes("v1=")) {
    return verifyHmac(webhookKey);
  }

  // 2. Legacy / Static X-Webhook-Key header fallback
  if (webhookKey && checkSecretMatch(webhookKey)) {
    return { success: true, authStrategy: "legacy_static_key" };
  }

  // 3. Static Header (X-Webhook-Secret, X-Api-Key, etc.)
  if (staticHeader) {
    if (checkSecretMatch(staticHeader)) {
      return { success: true, authStrategy: "static_header" };
    }
    return {
      success: false,
      status: 401,
      error: "Invalid webhook secret in header",
    };
  }

  // 4. Authorization Header (Bearer <secret>)
  if (authHeader) {
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : authHeader.trim();
    if (checkSecretMatch(bearerToken)) {
      return { success: true, authStrategy: "bearer_token" };
    }
    return {
      success: false,
      status: 401,
      error: "Invalid authorization token",
    };
  }

  // 5. Query Parameter (?secret=..., ?token=...)
  if (querySecret) {
    if (checkSecretMatch(querySecret)) {
      return { success: true, authStrategy: "query_param" };
    }
    return {
      success: false,
      status: 401,
      error: "Invalid webhook secret in query parameter",
    };
  }

  // 6. Body Secret Token
  if (bodySecret && typeof bodySecret === "string") {
    if (checkSecretMatch(bodySecret)) {
      return { success: true, authStrategy: "body_secret" };
    }
    return {
      success: false,
      status: 401,
      error: "Invalid webhook secret in payload body",
    };
  }

  // If X-Webhook-Key was passed but neither a valid HMAC nor matched the secret
  if (webhookKey) {
    return {
      success: false,
      status: 401,
      error:
        "Invalid X-Webhook-Key format. Requests must be signed with timestamp (t) and signature (v1), or match valid webhook secret",
    };
  }

  return {
    success: false,
    status: 401,
    error:
      "Missing webhook authentication credentials (HMAC signature, static secret header, query token, or body secret required)",
  };
}
