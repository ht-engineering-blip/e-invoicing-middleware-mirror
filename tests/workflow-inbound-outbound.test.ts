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
    return;
  }
  console.error("Unhandled Rejection:", reason);
});

import { describe, it, expect, spyOn, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import mongoose from "mongoose";
import * as jwt from "jsonwebtoken";
import { jwtConfig } from "../src/@config/jwt";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { InboundWorkflowService } from "../src/v1/workflow/services";
import { OutboundWorkflowService } from "../src/v1/workflow/services";
import { v1Routes } from "../src/v1";
import { errorHandlerMiddleware } from "../src/middlewares";

describe("Workflow Inbound and Outbound Endpoints", () => {
  let app: any;
  let mockToken: string;
  let handleInboundSpy: any;
  let handleOutboundSpy: any;

  beforeAll(async () => {
    await connectMongo();


    mockToken = jwt.sign(
      {
        type: "api_key",
        tenantId: "TES-1056-6B20",
        businessId: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
        businessName: "Test Business",
        businessTIN: "61392352-1056",
        scopes: ["*"],
      },
      jwtConfig?.secret || "test-secret",
      { algorithm: (jwtConfig?.algorithm as jwt.Algorithm) || "HS256" },
    );

    app = new Elysia().use(errorHandlerMiddleware).use(v1Routes);

    handleInboundSpy = spyOn(
      InboundWorkflowService.prototype,
      "handleInboundWorkflow",
    ).mockImplementation(async (invoice: any, transmit: boolean) => {
      if (invoice.irn === "FAIL-IRN") {
        return {
          status: false,
          error: "Inbound invoice 'FAIL-IRN' not found or empty on FIRS",
          data: null,
        };
      }
      return {
        status: true,
        data: {
          irn: invoice.irn,
          decrypted: true,
          invoice_number: "INV-001",
        },
      };
    });

    handleOutboundSpy = spyOn(
      OutboundWorkflowService.prototype,
      "handleOutboundWorkflow",
    ).mockImplementation(async (invoice: any, transmit: boolean) => {
      return {
        qrCode: "data:image/png;base64,mockqrcode",
        data: "mock-encrypted-data",
      };
    });
  });

  afterAll(async () => {
    if (handleInboundSpy) handleInboundSpy.mockRestore();
    if (handleOutboundSpy) handleOutboundSpy.mockRestore();
    await mongoose.disconnect();
  });

  describe("POST /v1/workflow/inbound", () => {
    it("should process inbound invoice successfully and return standardized response", async () => {
      const response = await app.handle(
        new Request("http://localhost/v1/workflow/inbound", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mockToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            irn: "INV1234-SERVICEID-20260805",
          }),
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe("Inbound invoice processed successfully");
      expect(body.data.irn).toBe("INV1234-SERVICEID-20260805");
      expect(body.data.decrypted).toBe(true);
    });

    it("should return error response when inbound processing fails", async () => {
      const response = await app.handle(
        new Request("http://localhost/v1/workflow/inbound", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mockToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            irn: "FAIL-IRN",
          }),
        }),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain("Inbound invoice 'FAIL-IRN' not found");
    });
  });

  describe("POST /v1/workflow/outbound", () => {
    it("should process outbound invoice successfully and return standardized response", async () => {
      const payload = {
        business_id: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
        irn: "882D701391687-34A843BE-20260725",
        invoice_number: "INV-1024",
        issue_date: "2026-07-25",
        invoice_type_code: "396",
        invoice_kind: "B2B",
        payment_status: "PENDING",
        document_currency_code: "NGN",
        accounting_supplier_party: {
          party_name: "Heirs Limited",
          tin: "61392352-1056",
          email: "supplier@heirs.com",
        },
        accounting_customer_party: {
          party_name: "Customer Limited",
          tin: "1234567893",
          email: "customer@heirs.com",
        },
        legal_monetary_total: {
          line_extension_amount: 1000,
          tax_exclusive_amount: 1000,
          tax_inclusive_amount: 1075,
          payable_amount: 1075,
        },
        invoice_line: [
          {
            hsn_code: "1234.00",
            product_category: "General Goods",
            invoiced_quantity: 1,
            line_extension_amount: 1000,
            item: { name: "Item 1", description: "General goods item" },
            price: { price_amount: 1000, base_quantity: 1, price_unit: "H87" },
          },
        ],
        tax_total: [
          {
            tax_amount: 75,
            tax_subtotal: [
              {
                taxable_amount: 1000,
                tax_amount: 75,
                tax_category: { id: "STANDARD_VAT", percent: 7.5 },
              },
            ],
          },
        ],
      };

      const response = await app.handle(
        new Request("http://localhost/v1/workflow/outbound?transmit=true", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mockToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe("Outbound invoice processed successfully");
      expect(body.data.qrCode).toBe("data:image/png;base64,mockqrcode");
    });
  });
});
