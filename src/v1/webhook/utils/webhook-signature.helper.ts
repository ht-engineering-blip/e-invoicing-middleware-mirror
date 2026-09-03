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
 * Verifies the inbound webhook signature.
 * Returns an object indicating success or failure.
 */
export async function verifyWebhookSignature({
  headers,
  rawBody,
  tenant,
}: {
  headers: Record<string, string | undefined>;
  rawBody: string;
  tenant: {
    tenantId: string;
    config?: {
      webhookAuth?: string;
      webhookExpiresAt?: Date;
      webhookLifespan?: string;
    };
    metadata?: {
      webhookSecretHash?: string;
      webhookExpiresAt?: Date;
      webhookLifespan?: string;
    };
  };
}): Promise<
  { success: true } | { success: false; status: number; error: string }
> {
  const secret = tenant.config?.webhookAuth;
  const webhookKeyHash = tenant.metadata?.webhookSecretHash;

  // Reject requests when no signing secret is configured so verification cannot pass by default
  if (!secret || !webhookKeyHash) {
    return {
      success: false,
      status: 401,
      error: "Webhook signing secret is not configured for this tenant",
    };
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

  const webhookKey = headers["x-webhook-key"];
  if (!webhookKey) {
    return {
      success: false,
      status: 401,
      error: "Missing X-Webhook-Key header",
    };
  }

  const isSecureFormat =
    webhookKey.includes("t=") && webhookKey.includes("v1=");

  if (!isSecureFormat) {
    return {
      success: false,
      status: 401,
      error:
        "Invalid X-Webhook-Key format. Requests must be signed with timestamp (t) and signature (v1)",
    };
  }

  const parts = webhookKey.split(",");
  let tStr = "";
  let v1 = "";
  for (const part of parts) {
    const [key, val] = part.split("=");
    if (key === "t") tStr = val;
    if (key === "v1") v1 = val;
  }

  if (!tStr || !v1) {
    return {
      success: false,
      status: 401,
      error: "Invalid X-Webhook-Key format (missing t or v1)",
    };
  }

  const t = parseInt(tStr, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(t) || Math.abs(now - t) > 300) {
    return {
      success: false,
      status: 401,
      error: "Webhook request expired or timestamp invalid",
    };
  }

  const isReplay = await webhookNonceRepo.findOne({
    tenantId: tenant.tenantId,
    t,
    v1,
  });
  if (isReplay) {
    return {
      success: false,
      status: 401,
      error: "Duplicate webhook request detected (replay prevention)",
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
      success: false,
      status: 401,
      error: "Invalid webhook signature",
    };
  }

  await webhookNonceRepo.create({
    tenantId: tenant.tenantId,
    t,
    v1,
  });

  return { success: true };
}

