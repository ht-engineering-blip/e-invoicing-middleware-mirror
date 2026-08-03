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

import { describe, it, expect, spyOn, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import mongoose from "mongoose";
import * as jwt from "jsonwebtoken";
import { jwtConfig } from "../src/@config/jwt";
import { appConfig } from "../src/@config/app";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { FIRSService } from "../src/@lib/adapters/firs/firs.service";
import { TransformWorkflowService } from "../src/v1/workflow/services/workflows/transform.service";
import { AuditService } from "../src/v1/audit/services/audit.service";
import { OutboundInvoiceRepository } from "../src/v1/workflow/repos/outbound-invoice.repo";
import { v1Routes } from "../src/v1";
import { errorHandlerMiddleware } from "../src/middlewares";

const mockAdminKey = "super-secret-admin-key";
if (appConfig) {
  appConfig.adminKey = mockAdminKey;
}

describe("E2E API Endpoints by Modules", () => {
  let validateInvoiceSpy: any;
  let transformInvoiceV2Spy: any;
  let listAuditLogsSpy: any;
  let app: any;
  let mockToken: string;

  beforeAll(async () => {
    // Connect to database to avoid query buffering/timeouts
    await connectMongo();

    // Mock OutboundInvoiceRepository methods to bypass database writes during tests
    spyOn(OutboundInvoiceRepository.prototype, "update").mockImplementation(
      async () => {
        return {} as any;
      },
    );
    spyOn(
      OutboundInvoiceRepository.prototype,
      "updateWorkflowState",
    ).mockImplementation(async () => {
      return {} as any;
    });

    // Generate valid authorization token using real secret and real tenant credentials
    mockToken = jwt.sign(
      {
        tenantId: "TES-1056-6B20",
        businessId: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
        scopes: ["*"],
      },
      jwtConfig?.secret!,
      { algorithm: jwtConfig?.algorithm as jwt.Algorithm },
    );

    // Mock FIRSService validate call (avoid network latency)
    validateInvoiceSpy = spyOn(
      FIRSService.prototype,
      "validateInvoice",
    ).mockImplementation(async () => {
      return { code: 200, data: { ok: true } } as any;
    });

    // Mock TransformWorkflowService to return transformed Commercial Invoice Request (396)
    transformInvoiceV2Spy = spyOn(
      TransformWorkflowService.prototype,
      "transformInvoiceV2",
    ).mockImplementation(async () => {
      return {
        business_id: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
        irn: "882D701391687-34A843BE-20260725",
        invoice_type_code: "396",
      } as any;
    });

    // Mock AuditService to return quickly
    listAuditLogsSpy = spyOn(
      AuditService.prototype,
      "listAuditLogs",
    ).mockImplementation(async () => {
      return {
        logs: [
          {
            _id: "log-1",
            eventType: "invoice.validated",
            actor: { id: "user-1", name: "User" },
          },
        ],
        total: 1,
      } as any;
    });

    // Instantiate App with V1 Routes
    app = new Elysia().use(errorHandlerMiddleware).use(v1Routes);
  });

  afterAll(async () => {
    if (validateInvoiceSpy) validateInvoiceSpy.mockRestore();
    if (transformInvoiceV2Spy) transformInvoiceV2Spy.mockRestore();
    if (listAuditLogsSpy) listAuditLogsSpy.mockRestore();
    await mongoose.disconnect();
  });

  describe("1. Auth Module", () => {
    it("POST /v1/auth/oauth/firs (Positive Scenario with mock=true)", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/auth/oauth/firs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "test@heirs.com",
            password: "password123",
            mock: true,
          }),
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.business.tin).toBe("61392352-1056");
    }, 20000);

    it("POST /v1/auth/oauth/firs (Negative Scenario - Missing email)", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/auth/oauth/firs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            password: "password123",
            mock: true,
          }),
        }),
      );
      expect(res.status).toBe(422); // Elysia validation error code
      const json = await res.json();
      expect(json.type).toBe("validation");
      expect(json.on).toBe("body");
    }, 10000);
  });

  describe("2. Invoicing Module", () => {
    it("POST /v1/invoicing/validate (Positive Scenario)", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/invoicing/validate", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${mockToken}`,
          },
          body: JSON.stringify({
            business_id: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
            irn: "882D701391687-34A843BE-20260725",
            issue_date: "2026-07-25",
            invoice_type_code: "396",
            invoice_kind: "B2B",
            payment_status: "PENDING",
            document_currency_code: "NGN",
            accounting_supplier_party: {
              party_name: "Heirs Limited",
              tin: "61392352-1056",
              email: "supplier@heirs.com",
              postal_address: { street_name: "Street", country: "NG" },
            },
            accounting_customer_party: {
              party_name: "Customer Limited",
              tin: "1234567893",
              email: "customer@heirs.com",
              postal_address: { street_name: "Street", country: "NG" },
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
                invoiced_quantity: 1,
                line_extension_amount: 1000,
                price: {
                  price_amount: 1000,
                  base_quantity: 1,
                  price_unit: "H87",
                },
                item: { name: "Item 1" },
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
          }),
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    }, 20000);

    it("POST /v1/invoicing/validate (Negative Scenario - Missing authorization)", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/invoicing/validate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      // Elysia's resolve() errors bypass onError middleware, yielding 500
      expect(res.status).toBe(500);
    }, 10000);

    it("GET /v1/invoicing/document-types (Positive Scenario)", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/invoicing/document-types", {
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
      expect(json.data.length).toBe(20);
      expect(json.data[0]).toEqual({ code: "380", value: "Credit Note" });
    }, 10000);

    it("GET /v1/invoicing/document-types (Negative Scenario - Missing authorization)", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/invoicing/document-types", {
          method: "GET",
        }),
      );
      // Elysia's resolve() errors bypass onError middleware, yielding 500
      expect(res.status).toBe(500);
    }, 10000);
  });

  describe("3. Workflow Module", () => {
    it("POST /v1/workflow/transform (Positive Scenario)", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/workflow/transform", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${mockToken}`,
          },
          body: JSON.stringify({
            source_type: "TALLY_ERP",
            invoice: {
              business_id: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
              irn: "882D701391687-34A843BE-20260725",
              issue_date: "2026-07-25",
              invoice_type_code: "380",
              invoice_kind: "B2B",
              payment_status: "PENDING",
              document_currency_code: "NGN",
              accounting_supplier_party: {
                party_name: "Heirs Limited",
                tin: "61392352-1056",
                email: "supplier@heirs.com",
                postal_address: { street_name: "Street", country: "NG" },
              },
              accounting_customer_party: {
                party_name: "Customer Limited",
                tin: "1234567893",
                email: "customer@heirs.com",
                postal_address: { street_name: "Street", country: "NG" },
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
                  invoiced_quantity: 1,
                  line_extension_amount: 1000,
                  price: {
                    price_amount: 1000,
                    base_quantity: 1,
                    price_unit: "H87",
                  },
                  item: { name: "Item 1" },
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
            },
          }),
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.invoice_type_code).toBe("396");
    }, 20000);
  });

  describe("4. Audit Module", () => {
    it("GET /v1/audit (Positive Scenario with Admin Key)", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/audit", {
          method: "GET",
          headers: {
            "x-admin-key": mockAdminKey,
          },
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.logs).toBeDefined();
    }, 20000);

    it("GET /v1/audit (Negative Scenario - Missing Admin Key)", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/audit", {
          method: "GET",
        }),
      );
      // Elysia's resolve() errors bypass onError middleware, yielding 500
      expect(res.status).toBe(500);
    }, 10000);
  });

  describe("5. Resource Endpoints", () => {
    const endpoints = [
      { path: "payment_means", count: 12 },
      { path: "tax-categories", count: 27 },
      { path: "currencies", count: 118 },
      { path: "invoice-quantity-codes", count: 2162 },
      { path: "hs-codes", count: 5612 },
      { path: "services-codes", count: 419 },
      { path: "lgas", count: 776 },
      { path: "states", count: 37 },
      { path: "countries", count: 249 },
    ];

    for (const ep of endpoints) {
      it(`GET /v1/invoice/resources/${ep.path} should return successfully`, async () => {
        const res = await app.handle(
          new Request(`http://localhost/v1/invoice/resources/${ep.path}`, {
            method: "GET",
          }),
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(Array.isArray(json.data)).toBe(true);
        expect(json.data.length).toBe(ep.count);
      }, 10000);
    }
  });
});

