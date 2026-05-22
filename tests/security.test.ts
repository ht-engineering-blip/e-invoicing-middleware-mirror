import { describe, it, expect, mock, spyOn, beforeAll, afterAll } from "bun:test";
import { webhookRoutes } from "../src/v1/webhook";
import { TenantRepository } from "../src/v1/tenants/repos/tenant.repo";
import { WebhookEventRepository } from "../src/v1/webhook/repos/webhook-event.repo";
import { EventRoutingRepository } from "../src/v1/admin/repos/event-routing.repo";
import { OutboundInvoiceRepository } from "../src/v1/workflow/repos/outbound-invoice.repo";
import { WebhookNonceRepository } from "../src/v1/webhook/repos/webhook-nonce.repo";
import crypto from "crypto";

describe("Inbound Webhook Security (POST /v1/webhook/inbound/:webhookPath)", () => {
  const mockTenant = {
    tenantId: "tenant-123",
    status: "active",
    config: {
      webhookEnabled: true,
      webhookAuth: "super-secret-webhook-key-min-32-chars-length",
      erpSystem: "TEST",
    },
    metadata: {
      webhookSecretHash: "old-secret-hash",
    },
  };

  beforeAll(() => {
    // Spy on TenantRepository.findByWebhookPath
    spyOn(TenantRepository.prototype, "findByWebhookPath").mockImplementation(
      async (path: string) => {
        if (path === "valid-path") {
          return mockTenant as any;
        }
        if (path === "no-secret-path") {
          return {
            ...mockTenant,
            tenantId: "tenant-456",
            config: {
              ...mockTenant.config,
              webhookAuth: undefined,
            },
          } as any;
        }
        return null;
      }
    );

    // Spy on WebhookEventRepository methods
    spyOn(WebhookEventRepository.prototype, "create").mockImplementation(
      async (data: any) => ({ ...data, eventId: "wh_123" } as any)
    );
    spyOn(WebhookEventRepository.prototype, "findByIdempotencyKey").mockImplementation(
      async () => null
    );

    // Spy on EventRoutingRepository to prevent DB search
    spyOn(EventRoutingRepository.prototype, "getRoutesForEvent").mockImplementation(
      async () => []
    );

    // Spy on OutboundInvoiceRepository to prevent DB updates
    spyOn(OutboundInvoiceRepository.prototype, "findOrCreateByErpInvoiceId").mockImplementation(
      async (tenantId: string, erpInvoiceId: string, data: any) => ({
        doc: {
          irn: "IRN-VALID-123",
          erpSystem: "TEST",
          source: "webhook",
          createdBy: tenantId,
          metadata: {},
        },
        created: true,
      } as any)
    );

    spyOn(OutboundInvoiceRepository.prototype, "addWebhookEvent").mockImplementation(
      async () => ({}) as any
    );

    // Spy on WebhookNonceRepository methods
    spyOn(WebhookNonceRepository.prototype, "findOne").mockImplementation(async (query: any) => {
      if (query.v1 === "replay-nonce") {
        return { tenantId: query.tenantId, t: query.t, v1: query.v1 } as any;
      }
      return null;
    });

    spyOn(WebhookNonceRepository.prototype, "create").mockImplementation(async (data: any) => {
      return data as any;
    });
  });

  it("should reject request with 401 if x-signature header is missing", async () => {
    const app = webhookRoutes;
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event: "invoice.received", erpInvoiceId: "INV-123" }),
      })
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Missing X-Signature header");
  });

  it("should reject request with 401 if x-signature header format is invalid", async () => {
    const app = webhookRoutes;
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": "invalid-format-without-equals",
        },
        body: JSON.stringify({ event: "invoice.received" }),
      })
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid X-Signature header format");
  });

  it("should reject request with 401 if timestamp in x-signature has expired (> 300s)", async () => {
    const app = webhookRoutes;
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 301;
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": `t=${expiredTimestamp},v1=somehexsignature`,
        },
        body: JSON.stringify({ event: "invoice.received" }),
      })
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Webhook request expired or timestamp invalid");
  });

  it("should reject request with 401 if nonce has already been used (replay protection)", async () => {
    const app = webhookRoutes;
    const now = Math.floor(Date.now() / 1000);
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": `t=${now},v1=replay-nonce`,
        },
        body: JSON.stringify({ event: "invoice.received" }),
      })
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Duplicate webhook request detected");
  });

  it("should reject request with 401 if webhook secret is not configured", async () => {
    const app = webhookRoutes;
    const now = Math.floor(Date.now() / 1000);
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/no-secret-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": `t=${now},v1=somesig`,
        },
        body: JSON.stringify({ event: "invoice.received" }),
      })
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Webhook secret not configured");
  });

  it("should reject request with 401 if webhook signature is invalid", async () => {
    const app = webhookRoutes;
    const now = Math.floor(Date.now() / 1000);
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": `t=${now},v1=abcdef0123456789`,
        },
        body: JSON.stringify({ event: "invoice.received" }),
      })
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid webhook signature");
  });

  it("should accept valid webhook signature, persist nonce, and process event successfully", async () => {
    const app = webhookRoutes;
    const now = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({ event: "invoice.received", erpInvoiceId: "INV-123" });
    const dataToSign = `${now}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac("sha256", mockTenant.config.webhookAuth)
      .update(dataToSign)
      .digest("hex");

    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": `t=${now},v1=${expectedSignature}`,
        },
        body: rawBody,
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("Webhook received successfully");
  });
});
