import { mock } from "bun:test";
import path from "node:path";

// Mock @agendajs/mongo-backend globally to completely suppress any MongoBackend connection attempts
mock.module("@agendajs/mongo-backend", () => {
  return {
    MongoBackend: class {
      constructor() {}
      async connect() {
        return this;
      }
      async database() {
        return {
          collection: () => ({
            findOne: () => Promise.resolve(null),
            find: () => ({
              toArray: () => Promise.resolve([]),
            }),
            insertOne: () => Promise.resolve({}),
            updateOne: () => Promise.resolve({}),
            createIndex: () => Promise.resolve({}),
          }),
        };
      }
    },
  };
});

// Mock agenda globally using all possible path permutations to guarantee resolution matching
const mockAgenda = {
  define: () => {},
  on: () => {},
  start: async () => {},
  schedule: async () => {},
  now: async () => {},
  cancel: async () => {},
};

const agendaPath = path.resolve(import.meta.dir, "../src/@lib/queue/agenda");
const pathsToMock = [
  agendaPath,
  `${agendaPath}.ts`,
  agendaPath.replace(/\\/g, "/"),
  `${agendaPath.replace(/\\/g, "/")}.ts`,
  agendaPath.toLowerCase(),
  `${agendaPath.toLowerCase()}.ts`,
  "../src/@lib/queue/agenda.ts",
  "../src/@lib/queue/agenda",
  "@lib/queue/agenda",
];

for (const p of pathsToMock) {
  mock.module(p, () => ({
    agenda: mockAgenda,
  }));
}

// Silence background MongoDB connection rejections during offline unit tests
process.on("unhandledRejection", (reason) => {
  const reasonStr = String(reason);
  if (
    reasonStr.includes("mongodb") ||
    reasonStr.includes("ECONNREFUSED") ||
    reasonStr.includes("querySrv")
  ) {
    return; // Silently swallow background connection failures
  }
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  const errStr = String(err);
  if (
    errStr.includes("mongodb") ||
    errStr.includes("ECONNREFUSED") ||
    errStr.includes("querySrv")
  ) {
    return; // Silently swallow background connection failures
  }
  console.error("Uncaught Exception:", err);
});

import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import crypto from "crypto";

describe("Inbound Webhook Security (POST /v1/webhook/inbound/:webhookPath)", () => {
  let webhookRoutes: any;
  let TenantRepository: any;
  let WebhookEventRepository: any;
  let EventRoutingRepository: any;
  let OutboundInvoiceRepository: any;
  let WebhookNonceRepository: any;

  const mockSecret = "super-secret-webhook-key-min-32-chars-length";
  const mockSecretHash = crypto
    .createHash("sha256")
    .update(mockSecret)
    .digest("hex");

  const mockTenant = {
    tenantId: "tenant-123",
    status: "active",
    config: {
      webhookEnabled: true,
      webhookAuth: mockSecret,
      erpSystem: "TEST",
    },
    metadata: {
      webhookSecretHash: mockSecretHash,
    },
  };

  let findByWebhookPathSpy: any;
  let createEventSpy: any;
  let findByIdempotencyKeySpy: any;
  let getRoutesForEventSpy: any;
  let findOrCreateByErpInvoiceIdSpy: any;
  let addWebhookEventSpy: any;
  let findOneNonceSpy: any;
  let createNonceSpy: any;

  beforeAll(async () => {
    const tenantMod = await import("../src/v1/tenants/repos/tenant.repo");
    TenantRepository = tenantMod.TenantRepository;
    const eventMod = await import("../src/v1/webhook/repos/webhook-event.repo");
    WebhookEventRepository = eventMod.WebhookEventRepository;
    const routeMod = await import("../src/v1/admin/repos/event-routing.repo");
    EventRoutingRepository = routeMod.EventRoutingRepository;
    const outboundMod =
      await import("../src/v1/workflow/repos/outbound-invoice.repo");
    OutboundInvoiceRepository = outboundMod.OutboundInvoiceRepository;
    const nonceMod = await import("../src/v1/webhook/repos/webhook-nonce.repo");
    WebhookNonceRepository = nonceMod.WebhookNonceRepository;

    // Spy on TenantRepository.findByWebhookPath
    const origFindByWebhookPath = TenantRepository.prototype.findByWebhookPath;
    findByWebhookPathSpy = spyOn(
      TenantRepository.prototype,
      "findByWebhookPath",
    ).mockImplementation(async function (this: any, path: string) {
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
          metadata: {
            ...mockTenant.metadata,
            webhookSecretHash: undefined,
          },
        } as any;
      }
      if (path === "expired-path") {
        return {
          ...mockTenant,
          tenantId: "tenant-789",
          metadata: {
            ...mockTenant.metadata,
            webhookExpiresAt: new Date(Date.now() - 60000),
          },
        } as any;
      }
      if (path === "non-existent-path") {
        return null;
      }
      return origFindByWebhookPath.call(this, path);
    });

    // Spy on WebhookEventRepository methods
    const origCreateEvent = WebhookEventRepository.prototype.create;
    createEventSpy = spyOn(
      WebhookEventRepository.prototype,
      "create",
    ).mockImplementation(async function (this: any, data: any) {
      if (data?.tenantId === "tenant-123" || data?.tenantId === "tenant-456") {
        return { ...data, eventId: "wh_123" } as any;
      }
      return origCreateEvent.call(this, data);
    });

    const origFindByIdempotencyKey =
      WebhookEventRepository.prototype.findByIdempotencyKey;
    findByIdempotencyKeySpy = spyOn(
      WebhookEventRepository.prototype,
      "findByIdempotencyKey",
    ).mockImplementation(async function (
      this: any,
      tenantId: string,
      key: string,
    ) {
      if (tenantId === "tenant-123" || tenantId === "tenant-456") {
        return null;
      }
      return origFindByIdempotencyKey.call(this, tenantId, key);
    });

    // Spy on EventRoutingRepository to prevent DB search
    const origGetRoutesForEvent =
      EventRoutingRepository.prototype.getRoutesForEvent;
    getRoutesForEventSpy = spyOn(
      EventRoutingRepository.prototype,
      "getRoutesForEvent",
    ).mockImplementation(async function (
      this: any,
      tenantId: string,
      event: string,
    ) {
      if (tenantId === "tenant-123" || tenantId === "tenant-456") {
        return [];
      }
      return origGetRoutesForEvent.call(this, tenantId, event);
    });

    // Spy on OutboundInvoiceRepository to prevent DB updates
    const origFindOrCreate =
      OutboundInvoiceRepository.prototype.findOrCreateByErpInvoiceId;
    findOrCreateByErpInvoiceIdSpy = spyOn(
      OutboundInvoiceRepository.prototype,
      "findOrCreateByErpInvoiceId",
    ).mockImplementation(async function (
      this: any,
      tenantId: string,
      erpInvoiceId: string,
      data: any,
    ) {
      if (tenantId === "tenant-123" || tenantId === "tenant-456") {
        return {
          doc: {
            irn: "IRN-VALID-123",
            erpSystem: "TEST",
            source: "webhook",
            createdBy: tenantId,
            metadata: {},
          },
          created: true,
        } as any;
      }
      return origFindOrCreate.call(this, tenantId, erpInvoiceId, data);
    });

    const origAddWebhookEvent =
      OutboundInvoiceRepository.prototype.addWebhookEvent;
    addWebhookEventSpy = spyOn(
      OutboundInvoiceRepository.prototype,
      "addWebhookEvent",
    ).mockImplementation(async function (
      this: any,
      irn: string,
      eventId: string,
    ) {
      if (irn === "IRN-VALID-123") {
        return {} as any;
      }
      return origAddWebhookEvent.call(this, irn, eventId);
    });

    // Spy on WebhookNonceRepository methods
    const origFindOneNonce = WebhookNonceRepository.prototype.findOne;
    findOneNonceSpy = spyOn(
      WebhookNonceRepository.prototype,
      "findOne",
    ).mockImplementation(async function (this: any, query: any) {
      if (
        query?.tenantId === "tenant-123" ||
        query?.tenantId === "tenant-456"
      ) {
        if (query.v1 === "replay-nonce") {
          return { tenantId: query.tenantId, t: query.t, v1: query.v1 } as any;
        }
        return null;
      }
      return origFindOneNonce.call(this, query);
    });

    const origCreateNonce = WebhookNonceRepository.prototype.create;
    createNonceSpy = spyOn(
      WebhookNonceRepository.prototype,
      "create",
    ).mockImplementation(async function (this: any, data: any) {
      if (data?.tenantId === "tenant-123" || data?.tenantId === "tenant-456") {
        return data as any;
      }
      return origCreateNonce.call(this, data);
    });

    // Load routes Mod LAST to ensure all class prototypes are already spied/mocked when constructors are run!
    const routesMod = await import("../src/v1/webhook");
    webhookRoutes = routesMod.webhookRoutes;
  });

  afterAll(() => {
    if (findByWebhookPathSpy) findByWebhookPathSpy.mockRestore();
    if (createEventSpy) createEventSpy.mockRestore();
    if (findByIdempotencyKeySpy) findByIdempotencyKeySpy.mockRestore();
    if (getRoutesForEventSpy) getRoutesForEventSpy.mockRestore();
    if (findOrCreateByErpInvoiceIdSpy)
      findOrCreateByErpInvoiceIdSpy.mockRestore();
    if (addWebhookEventSpy) addWebhookEventSpy.mockRestore();
    if (findOneNonceSpy) findOneNonceSpy.mockRestore();
    if (createNonceSpy) createNonceSpy.mockRestore();
  });

  // --- Common Missing Header Test ---
  it("should reject request with 401 if x-webhook-key header is missing", async () => {
    const app = webhookRoutes;
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event: "invoice.received",
          erpInvoiceId: "INV-123",
        }),
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Missing X-Webhook-Key header");
  });

  // --- Secure Signature Flow Tests ---
  it("should reject request with 401 if x-webhook-key format is invalid in secure mode", async () => {
    const app = webhookRoutes;
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Key": "t=,v1=",
        },
        body: JSON.stringify({ event: "invoice.received" }),
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid X-Webhook-Key format");
  });

  it("should reject request with 401 if timestamp in secure signature has expired (> 300s)", async () => {
    const app = webhookRoutes;
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 301;
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Key": `t=${expiredTimestamp},v1=somehexsignature`,
        },
        body: JSON.stringify({ event: "invoice.received" }),
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain(
      "Webhook request expired or timestamp invalid",
    );
  });

  it("should reject request with 401 if nonce has already been used in secure mode (replay protection)", async () => {
    const app = webhookRoutes;
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Key": `t=${timestamp},v1=replay-nonce`,
        },
        body: JSON.stringify({ event: "invoice.received" }),
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Duplicate webhook request detected");
  });

  it("should reject request with 401 if secure signature is invalid", async () => {
    const app = webhookRoutes;
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Key": `t=${timestamp},v1=invalidsignature`,
        },
        body: JSON.stringify({ event: "invoice.received" }),
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid webhook signature");
  });

  it("should accept request with 200 if secure signature is valid", async () => {
    const app = webhookRoutes;
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({
      event: "invoice.received",
      erpInvoiceId: "INV-123",
    });

    // Compute valid HMAC-SHA256 signature using test secret
    const dataToSign = `${timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac("sha256", mockSecret)
      .update(dataToSign)
      .digest("hex");

    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Key": `t=${timestamp},v1=${expectedSignature}`,
        },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("Webhook received successfully");
  });

  // --- Inbound Webhook Verification Hardening Tests ---
  it("should reject request with 401 if legacy static key is used (shared-key path removed)", async () => {
    const app = webhookRoutes;
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/valid-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Key": mockSecret,
        },
        body: JSON.stringify({
          event: "invoice.received",
          erpInvoiceId: "INV-123",
        }),
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid X-Webhook-Key format");
  });

  it("should reject request with 401 if webhook secret is not configured on tenant", async () => {
    const app = webhookRoutes;
    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/no-secret-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Key": "t=12345678,v1=fakesig",
        },
        body: JSON.stringify({
          event: "invoice.received",
          erpInvoiceId: "INV-123",
        }),
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain(
      "Webhook signing secret is not configured for this tenant",
    );
  });

  it("should reject request with 401 if webhook credentials have expired", async () => {
    const app = webhookRoutes;
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({
      event: "invoice.received",
      erpInvoiceId: "INV-123",
    });

    const dataToSign = `${timestamp}.${rawBody}`;
    const signature = crypto
      .createHmac("sha256", mockSecret)
      .update(dataToSign)
      .digest("hex");

    const response = await app.handle(
      new Request("http://localhost/webhook/inbound/expired-path", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Key": `t=${timestamp},v1=${signature}`,
        },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Webhook credentials have expired");
  });
});
