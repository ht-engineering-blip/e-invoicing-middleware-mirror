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

import { describe, it, expect, spyOn, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import mongoose from "mongoose";
import * as jwt from "jsonwebtoken";
import { jwtConfig } from "../src/@config/jwt";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { OutboundInvoiceRepository } from "../src/v1/workflow/repos/outbound-invoice.repo";
import { InboundInvoiceRepository } from "../src/v1/workflow/repos/inbound-invoice.repo";
import { v1Routes } from "../src/v1";
import { errorHandlerMiddleware } from "../src/middlewares";

describe("Unified Invoices Endpoint (GET /v1/workflow/invoices)", () => {
  let outboundFindManySpy: any;
  let inboundFindManySpy: any;
  let app: any;
  let mockToken: string;

  beforeAll(async () => {
    await connectMongo();

    mockToken = jwt.sign(
      {
        tenantId: "TES-1056-6B20",
        businessId: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
        scopes: ["*"],
      },
      jwtConfig?.secret!,
      { algorithm: jwtConfig?.algorithm as jwt.Algorithm },
    );

    outboundFindManySpy = spyOn(
      OutboundInvoiceRepository.prototype,
      "findMany",
    ).mockImplementation(async () => {
      return [
        {
          _id: "outbound-1",
          irn: "882D701-OUTBOUND-1",
          invoiceNumber: "INV-OUT-001",
          invoiceTypeCode: "396",
          issueDate: "2026-08-01",
          dueDate: "2026-09-01",
          status: "VALIDATED",
          paymentStatus: "PENDING",
          supplierName: "Heirs Technologies Limited",
          supplierTIN: "61392352-1056",
          customerName: "Client A",
          customerTIN: "1234567890",
          totalAmount: 50000,
          document_currency_code: "NGN",
          createdAt: new Date("2026-08-01T10:00:00Z"),
        },
      ] as any;
    });

    inboundFindManySpy = spyOn(
      InboundInvoiceRepository.prototype,
      "findMany",
    ).mockImplementation(async () => {
      return [
        {
          _id: "inbound-1",
          irn: "882D701-INBOUND-1",
          invoiceNumber: "INV-IN-001",
          invoiceTypeCode: "380",
          issueDate: "2026-08-02",
          dueDate: "2026-09-02",
          status: "TRANSMITTED",
          paymentStatus: "PAID",
          supplierName: "Vendor B",
          supplierTIN: "9876543210",
          customerName: "Heirs Technologies Limited",
          customerTIN: "61392352-1056",
          totalAmount: 120000,
          document_currency_code: "NGN",
          createdAt: new Date("2026-08-02T12:00:00Z"),
        },
      ] as any;
    });

    app = new Elysia().use(errorHandlerMiddleware).use(v1Routes);
  }, 30000);

  afterAll(async () => {
    if (outboundFindManySpy) outboundFindManySpy.mockRestore();
    if (inboundFindManySpy) inboundFindManySpy.mockRestore();
    await mongoose.disconnect();
  }, 30000);

  it("GET /v1/workflow/invoices (Unified All Streams - Positive)", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/workflow/invoices?type=all", {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(2);

    // Verify pagination metadata
    expect(json.meta).toBeDefined();
    expect(json.meta.total).toBe(2);
    expect(json.meta.page).toBe(1);
    expect(json.meta.countsByType.outbound).toBe(1);
    expect(json.meta.countsByType.inbound).toBe(1);

    // Verify ordering by date descending (inbound createdAt is 2026-08-02, outbound is 2026-08-01)
    expect(json.data[0].direction).toBe("INBOUND");
    expect(json.data[1].direction).toBe("OUTBOUND");
  });

  it("GET /v1/workflow/invoices?direction=outbound (Direction Filtered)", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/workflow/invoices?direction=outbound", {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].direction).toBe("OUTBOUND");
  });
});
