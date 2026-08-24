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

describe("Outbound Webhook Security & CORS Tests", () => {
  let webhookService: any;
  let webhookRoutes: any;

  const mockTenant = {
    tenantId: "tenant-123",
    status: "active",
    config: {
      webhookEnabled: true,
      webhookUrl: "https://allowed-origin.com/callback",
      webhookAuth: "super-secret",
    },
  };

  const mockEvent = {
    eventId: "wh_event_123",
    tenantId: "tenant-123",
    eventType: "invoice.received",
    payload: { id: 1 },
    deliveryAttempts: [],
  };

  let findByTenantIdSpy: any;
  let findByWebhookPathSpy: any;
  let findByIdSpy: any;
  let markAsFailedSpy: any;
  let markAsDeliveredSpy: any;
  let addDeliveryAttemptSpy: any;
  let createAuditSpy: any;
  let axiosPostSpy: any;
  let findOneSpy: any;
  let updateSpy: any;

  beforeAll(async () => {
    const { TenantRepository } =
      await import("../src/v1/tenants/repos/tenant.repo");
    const { WebhookEventRepository } =
      await import("../src/v1/webhook/repos/webhook-event.repo");
    const { AuditLogRepository } =
      await import("../src/v1/audit/repos/audit-log.repo");

    // Mock Repositories
    const origFindByTenantId = TenantRepository.prototype.findByTenantId;
    findByTenantIdSpy = spyOn(
      TenantRepository.prototype,
      "findByTenantId",
    ).mockImplementation(async function (this: any, id: string) {
      if (id === "tenant-123") return mockTenant as any;
      return origFindByTenantId.call(this, id);
    });

    const origFindByWebhookPath = TenantRepository.prototype.findByWebhookPath;
    findByWebhookPathSpy = spyOn(
      TenantRepository.prototype,
      "findByWebhookPath",
    ).mockImplementation(async function (this: any, path: string) {
      if (path === "valid-path") {
        return {
          tenantId: "tenant-123",
          config: {
            webhookUrl: "https://allowed-origin.com/callback",
          },
        } as any;
      }
      return origFindByWebhookPath.call(this, path);
    });

    const origFindById = WebhookEventRepository.prototype.findById;
    findByIdSpy = spyOn(
      WebhookEventRepository.prototype,
      "findById",
    ).mockImplementation(async function (this: any, id: string) {
      if (id === "wh_event_123") return mockEvent as any;
      return origFindById.call(this, id);
    });

    const origMarkAsFailed = WebhookEventRepository.prototype.markAsFailed;
    markAsFailedSpy = spyOn(
      WebhookEventRepository.prototype,
      "markAsFailed",
    ).mockImplementation(async function (
      this: any,
      id: string,
      reason: string,
      status?: number,
    ) {
      if (id === "wh_event_123") {
        return { ...mockEvent, status: "failed", failureReason: reason } as any;
      }
      return origMarkAsFailed.call(this, id, reason, status);
    });

    const origMarkAsDelivered =
      WebhookEventRepository.prototype.markAsDelivered;
    markAsDeliveredSpy = spyOn(
      WebhookEventRepository.prototype,
      "markAsDelivered",
    ).mockImplementation(async function (
      this: any,
      id: string,
      status: number,
      body: any,
    ) {
      if (id === "wh_event_123") {
        return { ...mockEvent, status: "delivered" } as any;
      }
      return origMarkAsDelivered.call(this, id, status, body);
    });

    const origAddDeliveryAttempt =
      WebhookEventRepository.prototype.addDeliveryAttempt;
    addDeliveryAttemptSpy = spyOn(
      WebhookEventRepository.prototype,
      "addDeliveryAttempt",
    ).mockImplementation(async function (
      this: any,
      eventId: string,
      attempt: any,
    ) {
      if (eventId === "wh_event_123") {
        return {} as any;
      }
      return origAddDeliveryAttempt.call(this, eventId, attempt);
    });

    const origCreateAudit = AuditLogRepository.prototype.create;
    createAuditSpy = spyOn(
      AuditLogRepository.prototype,
      "create",
    ).mockImplementation(async function (this: any, data: any) {
      if (data?.tenantId === "tenant-123") {
        return {} as any;
      }
      return origCreateAudit.call(this, data);
    });

    const origFindOne = TenantRepository.prototype.findOne;
    findOneSpy = spyOn(
      TenantRepository.prototype,
      "findOne",
    ).mockImplementation(async function (this: any, filter: any) {
      if (
        filter?.tenantId === "tenant-123" ||
        filter?.tenantId?._eq === "tenant-123"
      ) {
        return mockTenant as any;
      }
      return origFindOne.call(this, filter);
    });

    const origUpdate = TenantRepository.prototype.update;
    updateSpy = spyOn(TenantRepository.prototype, "update").mockImplementation(
      async function (this: any, id: string, data: any) {
        if (id === "tenant-123") {
          return mockTenant as any;
        }
        return origUpdate.call(this, id, data);
      },
    );

    // Import WebhookService and webhook routes last
    const { WebhookService } =
      await import("../src/v1/webhook/services/webhook.service");
    const routesMod = await import("../src/v1/webhook");
    webhookRoutes = routesMod.webhookRoutes;
    const axios = (await import("axios")).default;

    // Mock axios.post
    axiosPostSpy = spyOn(axios, "post").mockImplementation(
      async (url, payload, config) => {
        if (config && config.maxRedirects === 0) {
          return { status: 200, data: { success: true } } as any;
        }
        throw new Error("Redirects not limited");
      },
    );

    webhookService = new WebhookService();
  });

  afterAll(() => {
    if (findByTenantIdSpy) findByTenantIdSpy.mockRestore();
    if (findByWebhookPathSpy) findByWebhookPathSpy.mockRestore();
    if (findByIdSpy) findByIdSpy.mockRestore();
    if (markAsFailedSpy) markAsFailedSpy.mockRestore();
    if (markAsDeliveredSpy) markAsDeliveredSpy.mockRestore();
    if (addDeliveryAttemptSpy) addDeliveryAttemptSpy.mockRestore();
    if (createAuditSpy) createAuditSpy.mockRestore();
    if (axiosPostSpy) axiosPostSpy.mockRestore();
    if (findOneSpy) findOneSpy.mockRestore();
    if (updateSpy) updateSpy.mockRestore();
  });

  describe("SSRF Outbound Guard", () => {
    it("should block private/reserved IP space webhooks", async () => {
      mockTenant.config.webhookUrl = "https://192.168.1.1/callback";
      expect(webhookService.deliverWebhook("wh_event_123")).rejects.toThrow(
        "Outbound webhook URL is blocked by SSRF guard",
      );
    });

    it("should block non-https webhooks", async () => {
      mockTenant.config.webhookUrl = "http://google.com/callback";
      expect(webhookService.deliverWebhook("wh_event_123")).rejects.toThrow(
        "Outbound webhook URL is blocked by SSRF guard",
      );
    });

    it("should block loopback interface webhooks", async () => {
      mockTenant.config.webhookUrl = "https://localhost/callback";
      expect(webhookService.deliverWebhook("wh_event_123")).rejects.toThrow(
        "Outbound webhook URL is blocked by SSRF guard",
      );
    });

    it("should allow valid public HTTPS webhooks", async () => {
      mockTenant.config.webhookUrl = "https://google.com/callback";
      const result = await webhookService.deliverWebhook("wh_event_123");
      expect(result).toBeDefined();
    });
  });

  describe("ERP Sync Configuration SSRF & Loopback Guard", () => {
    let tenantService: any;
    let TenantRepository: any;

    it("should block configureERPSync if baseUrl is a loopback URL", async () => {
      const { TenantService } =
        await import("../src/v1/tenants/services/tenant.service");
      tenantService = new TenantService();

      const configInput = {
        name: "My Test ERP",
        enabled: true,
        method: "GET",
        baseUrl: "https://localhost/api",
        endpoint: "/invoices",
      };

      expect(
        tenantService.configureERPSync("tenant-123", configInput),
      ).rejects.toThrow("ERP Sync baseUrl is blocked by SSRF guard");
    });

    it("should block configureERPSync if baseUrl is in private RFC1918 space", async () => {
      const { TenantService } =
        await import("../src/v1/tenants/services/tenant.service");
      tenantService = new TenantService();

      const configInput = {
        name: "My Test ERP",
        enabled: true,
        method: "GET",
        baseUrl: "https://192.168.1.1/api",
        endpoint: "/invoices",
      };

      expect(
        tenantService.configureERPSync("tenant-123", configInput),
      ).rejects.toThrow("ERP Sync baseUrl is blocked by SSRF guard");
    });

    it("should allow configureERPSync if baseUrl is a valid public URL", async () => {
      const { TenantService } =
        await import("../src/v1/tenants/services/tenant.service");
      tenantService = new TenantService();

      const configInput = {
        name: "My Test ERP",
        enabled: true,
        method: "GET",
        baseUrl: "https://google.com/api",
        endpoint: "/invoices",
      };

      const result = await tenantService.configureERPSync(
        "tenant-123",
        configInput,
      );
      expect(result).toBeDefined();
    });
  });
});
