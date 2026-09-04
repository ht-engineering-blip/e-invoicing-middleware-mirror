import { describe, it, expect, mock, spyOn, beforeAll, afterAll } from "bun:test";
import crypto from "crypto";
import path from "node:path";
import {
  signWebhookPayload,
  verifyWebhookSignature,
} from "../src/v1/webhook/utils/webhook-signature.helper";
import {
  parseXmlToJson,
  isXmlPayload,
} from "../src/v1/webhook/utils/xml-parser.helper";
import { TenantRepository } from "../src/v1/tenants/repos/tenant.repo";
import { WebhookEventRepository } from "../src/v1/webhook/repos/webhook-event.repo";
import { WebhookNonceRepository } from "../src/v1/webhook/repos/webhook-nonce.repo";
import { EventRoutingRepository } from "../src/v1/admin/repos/event-routing.repo";
import { OutboundInvoiceRepository } from "../src/v1/workflow/repos/outbound-invoice.repo";
import { inboundWebhookRoutes } from "../src/v1/webhook/routes/inbound-webhook.routes";

// Mock @agendajs/mongo-backend globally
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
  "../src/@lib/queue/agenda.ts",
  "../src/@lib/queue/agenda",
  "@lib/queue/agenda",
];

for (const p of pathsToMock) {
  mock.module(p, () => ({
    agenda: mockAgenda,
  }));
}

process.on("unhandledRejection", (reason) => {
  const reasonStr = String(reason);
  if (
    reasonStr.includes("mongodb") ||
    reasonStr.includes("ECONNREFUSED") ||
    reasonStr.includes("buffering timed out")
  ) {
    return;
  }
});

describe("Multi-Strategy Webhook Authentication & Legacy Support", () => {
  const testSecret = "test_webhook_secret_998877665544332211";
  const secretHash = crypto.createHash("sha256").update(testSecret).digest("hex");
  const webhookPath = "path_legacy_test_12345";

  const mockTenant = {
    tenantId: "tenant-legacy-001",
    config: {
      webhookAuth: testSecret,
      webhookEnabled: true,
      webhookAuthMode: "auto" as const,
      defaultEventType: "invoice.received",
      invoiceIdKey: "invoiceNumber",
    },
    metadata: {
      webhookSecretHash: secretHash,
      webhookPath,
    },
  };

  const nonces = new Set<string>();

  beforeAll(() => {
    spyOn(TenantRepository.prototype, "findByWebhookPath").mockImplementation(
      async (p: string) => {
        if (p === webhookPath) {
          return mockTenant as any;
        }
        return null;
      },
    );

    spyOn(WebhookNonceRepository.prototype, "findOne").mockImplementation(
      async (q: any) => {
        const key = `${q.tenantId}:${q.t}:${q.v1}`;
        if (nonces.has(key)) {
          return { ...q } as any;
        }
        return null;
      },
    );

    spyOn(WebhookNonceRepository.prototype, "create").mockImplementation(
      async (d: any) => {
        const key = `${d.tenantId}:${d.t}:${d.v1}`;
        nonces.add(key);
        return { ...d } as any;
      },
    );

    spyOn(WebhookEventRepository.prototype, "findByIdempotencyKey").mockImplementation(
      async () => null,
    );

    spyOn(WebhookEventRepository.prototype, "create").mockImplementation(
      async (data: any) => ({
        ...data,
        createdAt: new Date(),
      }),
    );

    spyOn(EventRoutingRepository.prototype, "getRoutesForEvent").mockImplementation(
      async () => [],
    );

    spyOn(OutboundInvoiceRepository.prototype, "findOne").mockImplementation(
      async () => null,
    );
  });

  describe("XML Parser Helper", () => {
    it("should detect XML payloads correctly", () => {
      expect(isXmlPayload("<root><item>test</item></root>")).toBe(true);
      expect(isXmlPayload('{"item": "test"}')).toBe(false);
      expect(isXmlPayload("")).toBe(false);
    });

    it("should parse simple XML into a JSON object", () => {
      const xml = `<INVOICE>
        <INVOICENUMBER>INV-2026-001</INVOICENUMBER>
        <AMOUNT>250000</AMOUNT>
      </INVOICE>`;
      const parsed = parseXmlToJson(xml);
      expect(parsed.INVOICE).toBeDefined();
      expect(parsed.INVOICE.INVOICENUMBER).toBe("INV-2026-001");
      expect(parsed.INVOICE.AMOUNT).toBe("250000");
      expect(parsed._rawXml).toBe(xml);
    });

    it("should parse nested Tally voucher XML into object", () => {
      const tallyXml = `<ENVELOPE>
        <BODY>
          <DATA>
            <TALLYMESSAGE>
              <VOUCHER>
                <VOUCHERNUMBER>VOUCH-999</VOUCHERNUMBER>
                <DATE>20260904</DATE>
              </VOUCHER>
            </TALLYMESSAGE>
          </DATA>
        </BODY>
      </ENVELOPE>`;
      const parsed = parseXmlToJson(tallyXml);
      expect(parsed.ENVELOPE.BODY.DATA.TALLYMESSAGE.VOUCHER.VOUCHERNUMBER).toBe("VOUCH-999");
      expect(parsed._rawXml).toBe(tallyXml);
    });

    it("should parse repeated elements into arrays", () => {
      const xml = `<ROOT>
        <ITEM>One</ITEM>
        <ITEM>Two</ITEM>
      </ROOT>`;
      const parsed = parseXmlToJson(xml);
      expect(Array.isArray(parsed.ROOT.ITEM)).toBe(true);
      expect(parsed.ROOT.ITEM).toEqual(["One", "Two"]);
    });
  });

  describe("verifyWebhookSignature Multi-Strategy", () => {
    const rawBody = JSON.stringify({ invoiceId: "INV-100", amount: 5000 });

    it("Strategy 1: Dynamic HMAC-SHA256 signature verification succeeds", async () => {
      const now = Math.floor(Date.now() / 1000);
      const signature = signWebhookPayload(testSecret, now, rawBody);
      const keyHeader = `t=${now},v1=${signature}`;

      const res = await verifyWebhookSignature({
        headers: { "x-webhook-key": keyHeader },
        rawBody,
        tenant: mockTenant,
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.authStrategy).toBe("hmac");
      }
    });

    it("Strategy 1: Dynamic HMAC detects replay attacks", async () => {
      const now = Math.floor(Date.now() / 1000) - 10;
      const signature = signWebhookPayload(testSecret, now, rawBody);
      const keyHeader = `t=${now},v1=${signature}`;

      // First call succeeds
      const first = await verifyWebhookSignature({
        headers: { "x-webhook-key": keyHeader },
        rawBody,
        tenant: mockTenant,
      });
      expect(first.success).toBe(true);

      // Replay attempt fails
      const replay = await verifyWebhookSignature({
        headers: { "x-webhook-key": keyHeader },
        rawBody,
        tenant: mockTenant,
      });
      expect(replay.success).toBe(false);
      if (!replay.success) {
        expect(replay.status).toBe(401);
        expect(replay.error).toContain("replay");
      }
    });

    it("Strategy 2: Static Secret Header (X-Webhook-Secret) succeeds in auto mode", async () => {
      const res = await verifyWebhookSignature({
        headers: { "x-webhook-secret": testSecret },
        rawBody,
        tenant: mockTenant,
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.authStrategy).toBe("static_header");
      }
    });

    it("Strategy 2: API Key Header (X-Api-Key) succeeds in auto mode", async () => {
      const res = await verifyWebhookSignature({
        headers: { "x-api-key": testSecret },
        rawBody,
        tenant: mockTenant,
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.authStrategy).toBe("static_header");
      }
    });

    it("Strategy 2: Authorization Bearer header succeeds in auto mode", async () => {
      const res = await verifyWebhookSignature({
        headers: { authorization: `Bearer ${testSecret}` },
        rawBody,
        tenant: mockTenant,
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.authStrategy).toBe("bearer_token");
      }
    });

    it("Strategy 3: Query parameter ?secret= succeeds in auto mode", async () => {
      const res = await verifyWebhookSignature({
        headers: {},
        rawBody,
        tenant: mockTenant,
        query: { secret: testSecret },
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.authStrategy).toBe("query_param");
      }
    });

    it("Strategy 3: Query parameter ?token= succeeds in auto mode", async () => {
      const res = await verifyWebhookSignature({
        headers: {},
        rawBody,
        tenant: mockTenant,
        query: { token: testSecret },
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.authStrategy).toBe("query_param");
      }
    });

    it("Strategy 4: Body secret property succeeds in auto mode", async () => {
      const res = await verifyWebhookSignature({
        headers: {},
        rawBody,
        tenant: mockTenant,
        bodyObj: { secret: testSecret, invoiceId: "INV-100" },
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.authStrategy).toBe("body_secret");
      }
    });

    it("Strategy 5: Capability Secret URL mode succeeds without headers or params", async () => {
      const secretUrlTenant = {
        ...mockTenant,
        config: {
          ...mockTenant.config,
          webhookAuthMode: "secret_url" as const,
        },
      };

      const res = await verifyWebhookSignature({
        headers: {},
        rawBody,
        tenant: secretUrlTenant,
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.authStrategy).toBe("secret_url");
      }
    });

    it("Strict Mode: authMode 'hmac' rejects static secret headers", async () => {
      const hmacTenant = {
        ...mockTenant,
        config: {
          ...mockTenant.config,
          webhookAuthMode: "hmac" as const,
        },
      };

      const res = await verifyWebhookSignature({
        headers: { "x-webhook-secret": testSecret },
        rawBody,
        tenant: hmacTenant,
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(401);
        expect(res.error).toContain("Missing X-Webhook-Key");
      }
    });

    it("Strict Mode: authMode 'static_secret' accepts static secret and rejects missing secret", async () => {
      const staticTenant = {
        ...mockTenant,
        config: {
          ...mockTenant.config,
          webhookAuthMode: "static_secret" as const,
        },
      };

      const validRes = await verifyWebhookSignature({
        headers: { "x-webhook-secret": testSecret },
        rawBody,
        tenant: staticTenant,
      });
      expect(validRes.success).toBe(true);

      const invalidRes = await verifyWebhookSignature({
        headers: {},
        rawBody,
        tenant: staticTenant,
      });
      expect(invalidRes.success).toBe(false);
      if (!invalidRes.success) {
        expect(invalidRes.status).toBe(401);
      }
    });

    it("Rejects invalid secret with 401", async () => {
      const res = await verifyWebhookSignature({
        headers: { "x-webhook-secret": "wrong_secret_12345" }, // gitleaks:allow
        rawBody,
        tenant: mockTenant,
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(401);
      }
    });

    it("Rejects expired webhook credentials with 401", async () => {
      const expiredTenant = {
        ...mockTenant,
        config: {
          ...mockTenant.config,
          webhookExpiresAt: new Date(Date.now() - 10000),
        },
      };

      const res = await verifyWebhookSignature({
        headers: { "x-webhook-secret": testSecret },
        rawBody,
        tenant: expiredTenant,
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(401);
        expect(res.error).toContain("expired");
      }
    });
  });

  describe("Inbound Webhook HTTP Route Integration", () => {
    it("should process inbound webhook with X-Webhook-Secret header", async () => {
      const res = await inboundWebhookRoutes.handle(
        new Request(`http://localhost/inbound/${webhookPath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Secret": testSecret,
          },
          body: JSON.stringify({
            invoiceNumber: "INV-LEGACY-001",
            totalAmount: 50000,
          }),
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.eventType).toBe("invoice.received");
    });

    it("should process inbound webhook with query parameter ?secret=", async () => {
      const res = await inboundWebhookRoutes.handle(
        new Request(`http://localhost/inbound/${webhookPath}?secret=${testSecret}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            invoiceNumber: "INV-LEGACY-002",
            totalAmount: 75000,
          }),
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it("should process inbound XML payload from legacy ERP", async () => {
      const xmlPayload = `<INVOICE>
        <invoiceNumber>INV-XML-001</invoiceNumber>
        <totalAmount>120000</totalAmount>
      </INVOICE>`;

      const res = await inboundWebhookRoutes.handle(
        new Request(`http://localhost/inbound/${webhookPath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/xml",
            "X-Webhook-Secret": testSecret,
          },
          body: xmlPayload,
        }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.eventType).toBe("invoice.received");
    });

    it("should reject inbound request without valid credentials with 401", async () => {
      const res = await inboundWebhookRoutes.handle(
        new Request(`http://localhost/inbound/${webhookPath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            invoiceNumber: "INV-UNAUTHORIZED",
          }),
        }),
      );

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });
});
