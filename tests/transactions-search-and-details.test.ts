import { mock } from "bun:test";
import path from "node:path";

// Mock Agenda globally
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
mock.module(agendaPath, () => ({ agenda: mockAgenda }));

import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { Elysia } from "elysia";
import * as jwt from "jsonwebtoken";
import { jwtConfig } from "../src/@config/jwt";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { errorHandlerMiddleware } from "../src/middlewares";
import { v1Routes } from "../src/v1";
import { OutboundInvoiceRepository } from "../src/v1/workflow/repos/outbound-invoice.repo";
import { InboundInvoiceRepository } from "../src/v1/workflow/repos/inbound-invoice.repo";

describe("Transactions Search and Details Endpoints", () => {
  let getUnifiedInvoiceStreamSpy: any;
  let findByIrnWithWebhookEventsSpy: any;
  let findInboundByIRNSpy: any;
  let app: any;
  let mockToken: string;

  const mockItems = [
    {
      _id: "outbound-1",
      irn: "IRN-OUT-1001",
      invoiceNumber: "INV-2026-001",
      customerName: "Acme Corporation",
      supplierName: "Heirs Technologies Limited",
      totalAmount: 50000,
      currency: "NGN",
      direction: "OUTBOUND",
      type: "outbound",
      status: "VALIDATED",
      paymentStatus: "PENDING",
      createdAt: new Date("2026-09-01T10:00:00Z"),
      updatedAt: new Date("2026-09-01T10:00:00Z"),
    },
    {
      _id: "inbound-1",
      irn: "IRN-IN-2001",
      invoiceNumber: "INV-2026-002",
      customerName: "Heirs Technologies Limited",
      supplierName: "Globex Logistics",
      totalAmount: 120000,
      currency: "NGN",
      direction: "INBOUND",
      type: "inbound",
      status: "TRANSMITTED",
      paymentStatus: "PAID",
      createdAt: new Date("2026-09-02T12:00:00Z"),
      updatedAt: new Date("2026-09-02T12:00:00Z"),
    },
  ];

  beforeAll(async () => {
    await connectMongo();

    const testTenantId = process.env.TEST_TENANT_ID || "test-tenant-id";
    const testBusinessId = process.env.TEST_BUSINESS_ID || "test-business-id";

    mockToken = jwt.sign(
      {
        tenantId: testTenantId,
        businessId: testBusinessId,
        scopes: ["*"],
      },
      jwtConfig?.secret!,
      { algorithm: jwtConfig?.algorithm as jwt.Algorithm },
    );

    getUnifiedInvoiceStreamSpy = spyOn(
      OutboundInvoiceRepository.prototype,
      "getUnifiedInvoiceStream",
    ).mockImplementation(async (opts: any) => {
      let filtered = [...mockItems];

      if (opts?.invoiceNumber) {
        filtered = filtered.filter((i) =>
          i.invoiceNumber.toLowerCase().includes(opts.invoiceNumber.toLowerCase()),
        );
      }

      if (opts?.customerName) {
        filtered = filtered.filter((i) =>
          i.customerName.toLowerCase().includes(opts.customerName.toLowerCase()),
        );
      }

      if (opts?.search) {
        const s = opts.search.toLowerCase();
        filtered = filtered.filter(
          (i) =>
            i.invoiceNumber.toLowerCase().includes(s) ||
            i.customerName.toLowerCase().includes(s) ||
            i.irn.toLowerCase().includes(s),
        );
      }

      return {
        items: filtered,
        total: filtered.length,
        countsByType: {
          outbound: filtered.filter((i) => i.direction === "OUTBOUND").length,
          inbound: filtered.filter((i) => i.direction === "INBOUND").length,
        },
      };
    });

    findByIrnWithWebhookEventsSpy = spyOn(
      OutboundInvoiceRepository.prototype,
      "findByIrnWithWebhookEvents",
    ).mockImplementation(async (irn: string) => {
      if (irn === "IRN-OUT-1001") {
        return {
          invoice: {
            irn: "IRN-OUT-1001",
            erpInvoiceId: "ERP-101",
            source: "api",
            tenantId: "test-tenant-id",
            status: "VALIDATED",
            paymentStatus: "PENDING",
            metadata: {
              transformedInvoice: {
                invoice_number: "INV-2026-001",
                accounting_customer_party: {
                  party_name: "Acme Corporation",
                },
              },
            },
            createdAt: new Date("2026-09-01T10:00:00Z"),
            updatedAt: new Date("2026-09-01T10:00:00Z"),
          } as any,
          webhookEvents: [],
        };
      }
      return null;
    });

    findInboundByIRNSpy = spyOn(
      InboundInvoiceRepository.prototype,
      "findByIRN",
    ).mockImplementation(async (irn: string) => {
      if (irn === "IRN-IN-2001") {
        return {
          irn: "IRN-IN-2001",
          invoiceNumber: "INV-2026-002",
          customerName: "Heirs Technologies Limited",
          tenantId: "test-tenant-id",
          businessId: "test-business-id",
          status: "TRANSMITTED",
          paymentStatus: "PAID",
          supplierTIN: "12345678",
          supplierName: "Globex Logistics",
          totalAmount: 120000,
          currency: "NGN",
          issueDate: new Date("2026-09-02"),
          dueDate: new Date("2026-10-02"),
          createdAt: new Date("2026-09-02T12:00:00Z"),
          updatedAt: new Date("2026-09-02T12:00:00Z"),
        } as any;
      }
      return null;
    });

    app = new Elysia().use(errorHandlerMiddleware).use(v1Routes);
  }, 30000);

  afterAll(async () => {
    if (getUnifiedInvoiceStreamSpy) getUnifiedInvoiceStreamSpy.mockRestore();
    if (findByIrnWithWebhookEventsSpy) findByIrnWithWebhookEventsSpy.mockRestore();
    if (findInboundByIRNSpy) findInboundByIRNSpy.mockRestore();
  });

  it("GET /v1/workflow/invoices returns invoiceNumber and customerName in list stream", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/workflow/invoices", {
        method: "GET",
        headers: { authorization: `Bearer ${mockToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(2);

    expect(json.data[0].invoiceNumber).toBe("INV-2026-001");
    expect(json.data[0].customerName).toBe("Acme Corporation");

    expect(json.data[1].invoiceNumber).toBe("INV-2026-002");
    expect(json.data[1].customerName).toBe("Heirs Technologies Limited");
  });

  it("GET /v1/workflow/invoices?search=INV-2026-001 filters by invoice number via search", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/workflow/invoices?search=INV-2026-001", {
        method: "GET",
        headers: { authorization: `Bearer ${mockToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].invoiceNumber).toBe("INV-2026-001");
  });

  it("GET /v1/workflow/invoices?search=Acme filters by customer name via search", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/workflow/invoices?search=Acme", {
        method: "GET",
        headers: { authorization: `Bearer ${mockToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].customerName).toBe("Acme Corporation");
  });

  it("GET /v1/workflow/invoices?invoiceNumber=INV-2026-002 filters by dedicated invoiceNumber param", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/workflow/invoices?invoiceNumber=INV-2026-002", {
        method: "GET",
        headers: { authorization: `Bearer ${mockToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].invoiceNumber).toBe("INV-2026-002");
  });

  it("GET /v1/workflow/invoices?customerName=Acme filters by dedicated customerName param", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/workflow/invoices?customerName=Acme", {
        method: "GET",
        headers: { authorization: `Bearer ${mockToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].customerName).toBe("Acme Corporation");
  });

  it("GET /v1/workflow/invoices/outbound/:irn returns invoiceNumber and customerName in detail", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/workflow/invoices/outbound/IRN-OUT-1001", {
        method: "GET",
        headers: { authorization: `Bearer ${mockToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.invoice.irn).toBe("IRN-OUT-1001");
    expect(json.data.invoice.invoiceNumber).toBe("INV-2026-001");
    expect(json.data.invoice.customerName).toBe("Acme Corporation");
  });

  it("GET /v1/workflow/invoices/inbound/:irn returns invoiceNumber and customerName in detail", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/workflow/invoices/inbound/IRN-IN-2001", {
        method: "GET",
        headers: { authorization: `Bearer ${mockToken}` },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.invoice.irn).toBe("IRN-IN-2001");
    expect(json.data.invoice.invoiceNumber).toBe("INV-2026-002");
    expect(json.data.invoice.customerName).toBe("Heirs Technologies Limited");
  });

  it("GET /v1/workflow/invoices/:irn returns invoiceNumber and customerName across streams", async () => {
    // 1. Outbound lookup via unified endpoint
    const resOutbound = await app.handle(
      new Request("http://localhost/v1/workflow/invoices/IRN-OUT-1001", {
        method: "GET",
        headers: { authorization: `Bearer ${mockToken}` },
      }),
    );
    expect(resOutbound.status).toBe(200);
    const jsonOutbound = await resOutbound.json();
    expect(jsonOutbound.success).toBe(true);
    expect(jsonOutbound.data.direction).toBe("OUTBOUND");
    expect(jsonOutbound.data.invoice.invoiceNumber).toBe("INV-2026-001");
    expect(jsonOutbound.data.invoice.customerName).toBe("Acme Corporation");

    // 2. Inbound lookup via unified endpoint
    const resInbound = await app.handle(
      new Request("http://localhost/v1/workflow/invoices/IRN-IN-2001", {
        method: "GET",
        headers: { authorization: `Bearer ${mockToken}` },
      }),
    );
    expect(resInbound.status).toBe(200);
    const jsonInbound = await resInbound.json();
    expect(jsonInbound.success).toBe(true);
    expect(jsonInbound.data.direction).toBe("INBOUND");
    expect(jsonInbound.data.invoice.invoiceNumber).toBe("INV-2026-002");
    expect(jsonInbound.data.invoice.customerName).toBe("Heirs Technologies Limited");
  });
});
