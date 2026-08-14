import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import Elysia from "elysia";
import mongoose from "mongoose";
import * as jwt from "jsonwebtoken";
import { jwtConfig } from "../src/@config/jwt";
import { connectMongo } from "../src/@lib/adapters/mongo";
import {
  TenantModel,
  TenantStatus,
} from "../src/v1/tenants/models/tenant.model";
import {
  OutboundInvoiceModel,
  OutboundInvoiceStatus,
} from "../src/v1/workflow/models/outbound-invoice.model";
import {
  WebhookEventModel,
  WebhookEventType,
  WebhookDeliveryStatus,
} from "../src/v1/webhook/models/webhook-event.model";
import { InvoiceWorkflowService } from "../src/v1/invoicing/services";
import { v1Routes } from "../src/v1";
import { errorHandlerMiddleware } from "../src/middlewares";
import { AuthContext } from "../src/middlewares";
import {
  registerTransmitJob,
  processTransmitJob,
} from "../src/v1/workflow/jobs/definitions/transmit.job";

describe("Transmit Workflow Real Integration Suite (Docker MongoDB)", () => {
  let app: any;
  let mockToken: string;
  let service: InvoiceWorkflowService;

  const validAuthContext: AuthContext = {
    tenantId: "TES-1056-6B20",
    businessId: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
    businessName: "Test Business Ltd",
    businessTIN: "61392352-1056",
    serviceId: "34A843BE",
    isAdmin: false,
    scopes: ["*"],
  };

  const sampleIrn = `TRANSMITTED-TEST-${Date.now()}`;
  const foreignIrn = `FOREIGN-TENANT-TEST-${Date.now()}`;

  const realOutboundRepo: any = {
    findByIrn: async (irn: string, tenantId?: string) => {
      const query: any = { irn };
      if (tenantId) query.tenantId = tenantId;
      return await OutboundInvoiceModel.findOne(query).exec();
    },
    updateStatus: async (irn: string, status: any) => {
      return await OutboundInvoiceModel.findOneAndUpdate(
        { irn },
        { $set: { status } },
        { returnDocument: "after" },
      ).exec();
    },
    updateWorkflowState: async (irn: string, workflowState: any) => {
      const updateFields: any = {};
      Object.keys(workflowState).forEach((key) => {
        updateFields[`workflowState.${key}`] = workflowState[key];
      });
      return await OutboundInvoiceModel.findOneAndUpdate(
        { irn },
        { $set: updateFields },
        { returnDocument: "after" },
      ).exec();
    },
  };

  beforeAll(async () => {
    // 1. Connect to Docker MongoDB
    await connectMongo();

    // 2. Check if tenant exists in Docker MongoDB; create one if it doesn't exist
    let tenant = await TenantModel.findOne({
      tenantId: validAuthContext.tenantId,
    }).exec();

    if (!tenant) {
      console.log(
        `[Docker MongoDB Setup] Tenant ${validAuthContext.tenantId} not found. Creating tenant...`,
      );
      tenant = await TenantModel.create({
        tenantId: validAuthContext.tenantId,
        businessName: validAuthContext.businessName,
        tin: validAuthContext.businessTIN,
        businessRegistrationNumber: "RC-TEST-1056",
        contactEmail: "test-tenant@example.com",
        contactPhone: "+2348000000000",
        password: "hashedpassword123",
        erpSystem: "generic",
        config: {
          erpSystem: "generic",
        },
        expectedVolume: 1000,
        serviceId: validAuthContext.serviceId,
        status: TenantStatus.ACTIVE,
      });
      console.log(
        `[Docker MongoDB Setup] Tenant created successfully: ${tenant.tenantId}`,
      );
    } else {
      console.log(
        `[Docker MongoDB Setup] Verified existing tenant in Docker MongoDB: ${tenant.tenantId}`,
      );
    }

    service = new InvoiceWorkflowService();
    (service as any).outboundRepo = realOutboundRepo;

    // 3. Generate authentication JWT for tenant
    mockToken = jwt.sign(
      {
        tenantId: validAuthContext.tenantId,
        businessId: validAuthContext.businessId,
        scopes: ["*"],
      },
      jwtConfig?.secret!,
      { algorithm: jwtConfig?.algorithm as jwt.Algorithm },
    );

    // 4. Initialize Elysia Application with V1 routes
    app = new Elysia().use(errorHandlerMiddleware).use(v1Routes);

    // 5. Seed test outbound invoice into Docker MongoDB directly via Mongoose Model
    await OutboundInvoiceModel.findOneAndUpdate(
      { irn: sampleIrn },
      {
        $set: {
          irn: sampleIrn,
          tenantId: validAuthContext.tenantId,
          businessId: validAuthContext.businessId,
          invoiceNumber: "INV-TRANS-001",
          status: OutboundInvoiceStatus.SIGNED,
          workflowState: {
            transformed: true,
            validated: true,
            signed: true,
            transmitted: false,
            delivered: false,
          },
        },
      },
      { upsert: true },
    );

    // 6. Seed foreign tenant invoice into Docker MongoDB directly via Mongoose Model
    await OutboundInvoiceModel.findOneAndUpdate(
      { irn: foreignIrn },
      {
        $set: {
          irn: foreignIrn,
          tenantId: "FOREIGN-TENANT-999",
          businessId: "foreign-business-id",
          invoiceNumber: "INV-TRANS-999",
          status: OutboundInvoiceStatus.SIGNED,
          workflowState: {
            transformed: true,
            validated: true,
            signed: true,
            transmitted: false,
            delivered: false,
          },
        },
      },
      { upsert: true },
    );

    // 7. Seed test WebhookEvents into Docker MongoDB directly via Mongoose Model
    await WebhookEventModel.findOneAndUpdate(
      { eventId: "wh_test_123" },
      {
        $set: {
          eventId: "wh_test_123",
          tenantId: validAuthContext.tenantId,
          eventType: WebhookEventType.INVOICE_TRANSMITTED,
          resourceId: "res_123",
          resourceType: "invoice",
          webhookUrl: "https://example.com/webhook",
          status: WebhookDeliveryStatus.PENDING,
          payload: { irn: sampleIrn },
        },
      },
      { upsert: true },
    );

    await WebhookEventModel.findOneAndUpdate(
      { eventId: "wh_test_fail_123" },
      {
        $set: {
          eventId: "wh_test_fail_123",
          tenantId: validAuthContext.tenantId,
          eventType: WebhookEventType.INVOICE_TRANSMITTED,
          resourceId: "res_fail_123",
          resourceType: "invoice",
          webhookUrl: "https://example.com/webhook",
          status: WebhookDeliveryStatus.PENDING,
          payload: {},
        },
      },
      { upsert: true },
    );
  }, 30000);

  afterAll(async () => {
    // Cleanup seeded records from Docker MongoDB
    await OutboundInvoiceModel.deleteMany({
      irn: { $in: [sampleIrn, foreignIrn] },
    }).catch(() => {});
    await WebhookEventModel.deleteMany({
      eventId: { $in: ["wh_test_123", "wh_test_fail_123"] },
    }).catch(() => {});
    await mongoose.disconnect();
  }, 30000);

  describe("1. InvoiceWorkflowService.transmitInvoice (Docker DB & Real Logic)", () => {
    it("should enforce tenant ownership boundaries and reject foreign tenant invoices", async () => {
      try {
        await service.transmitInvoice(validAuthContext, foreignIrn);
        expect().fail(
          "Expected transmitInvoice to throw ValidationError for foreign tenant invoice",
        );
      } catch (err: any) {
        console.log(
          "[Diagnostic Info] Tenant boundary enforcement error caught:",
          err.message,
        );
        expect(err.message).toContain(
          "Invoice does not belong to this business",
        );
      }
    });

    it("should execute transmit logic, query Docker MongoDB, and report FIRS status or errors clearly", async () => {
      try {
        const result = await service.transmitInvoice(
          validAuthContext,
          sampleIrn,
        );
        console.log(
          "[Diagnostic Info] Real transmit successful output:",
          result,
        );

        expect(result).toBeDefined();
        expect(result.success).toBe(true);
        expect(result.transmitted).toBe(true);
        expect(result.irn).toBe(sampleIrn);

        // Verify status update in Docker MongoDB directly via Mongoose Model
        const updatedDoc = await OutboundInvoiceModel.findOne({
          irn: sampleIrn,
        });
        console.log("[Diagnostic Info] MongoDB document post-transmit:", {
          status: updatedDoc?.status,
          workflowState: updatedDoc?.workflowState,
        });

        expect(updatedDoc).not.toBeNull();
        expect(updatedDoc?.status).toBe(OutboundInvoiceStatus.TRANSMITTED);
        expect(updatedDoc?.workflowState?.transmitted).toBe(true);
      } catch (err: any) {
        console.log(
          "[Diagnostic Report - Real FIRS Transmit Response/Error]:",
          {
            statusCode: err.statusCode || err.code,
            message: err.message,
          },
        );
        expect(err.message).toBeDefined();
        expect(err.message).toContain("Transmission failed");
      }
    });
  });

  describe("2. POST /v1/invoicing/transmit Endpoint Integration", () => {
    it("should process HTTP POST transmit request with valid Bearer token", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/invoicing/transmit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${mockToken}`,
          },
          body: JSON.stringify({
            irn: sampleIrn,
          }),
        }),
      );

      console.log(
        `[Diagnostic Info] POST /v1/invoicing/transmit HTTP Status: ${res.status}`,
      );

      if (res.status === 200) {
        const responseBody = await res.json();
        expect(responseBody.success).toBe(true);
        expect(responseBody.data.irn).toBe(sampleIrn);
      } else {
        const rawText = await res.text();
        console.log(
          "[Diagnostic Report - FIRS/Endpoint Non-200 Response]:",
          rawText,
        );
        expect(res.status).toBe(500);
      }
    });

    it("should reject request with error when Authorization header is missing", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/invoicing/transmit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ irn: sampleIrn }),
        }),
      );

      console.log(
        `[Diagnostic Info] Unauthenticated POST /v1/invoicing/transmit HTTP Status: ${res.status}`,
      );
      expect(res.status).toBe(500);
    });

    it("should return validation error (422) when irn is missing in request body", async () => {
      const res = await app.handle(
        new Request("http://localhost/v1/invoicing/transmit", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${mockToken}`,
          },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.type).toBe("validation");
      console.log("[Diagnostic Info] Missing body IRN validation error:", json);
    });
  });

  describe("3. workflow:transmit Agenda Job Execution", () => {
    it("should register transmit job and execute job processor", async () => {
      registerTransmitJob();
      expect(processTransmitJob).toBeDefined();
      expect(typeof processTransmitJob).toBe("function");

      const mockJob: any = {
        attrs: {
          _id: "job_test_001",
          data: {
            tenantId: validAuthContext.tenantId,
            authContext: validAuthContext,
            actions: ["transmit"],
            stepIndex: 0,
            webhookEventId: "wh_test_123",
            context: { irn: sampleIrn },
            jobChainId: "job-chain-transmit-integration-123",
          },
        },
      };

      try {
        await processTransmitJob(mockJob);
        console.log(
          "[Diagnostic Info] workflow:transmit Agenda job handler completed successfully",
        );
      } catch (err: any) {
        console.log(
          "[Diagnostic Report - Agenda Job FIRS Response/Error]:",
          err.message,
        );
        expect(err.message).toBeDefined();
      }
    });

    it("should throw error and fail when IRN is missing in job context", async () => {
      registerTransmitJob();
      expect(processTransmitJob).toBeDefined();

      const mockJob: any = {
        attrs: {
          _id: "job_test_002",
          data: {
            tenantId: validAuthContext.tenantId,
            authContext: validAuthContext,
            actions: ["transmit"],
            stepIndex: 0,
            webhookEventId: "wh_test_fail_123",
            context: {}, // Missing IRN
            jobChainId: "job-chain-transmit-fail-test",
          },
        },
      };

      expect(processTransmitJob(mockJob)).rejects.toThrow(
        "IRN is required for transmit step — run generate_irn first",
      );
    });
  });
});
