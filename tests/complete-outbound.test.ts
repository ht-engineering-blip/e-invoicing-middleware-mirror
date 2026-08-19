import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import crypto from "crypto";
import { Elysia } from "elysia";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { encryptSensitiveData } from "../src/@lib/crypto";
import { agenda } from "../src/@lib/queue/agenda";
import { errorHandlerMiddleware } from "../src/middlewares";
import { v1Routes } from "../src/v1";
import { EventRoutingModel } from "../src/v1/admin/models/event-routing.model";
import {
  TenantModel,
  TenantStatus,
} from "../src/v1/tenants/models/tenant.model";
import { registerCompleteOutboundJob } from "../src/v1/workflow/jobs/definitions/complete-outbound.job";
import {
  OutboundInvoiceModel,
  OutboundInvoiceStatus,
} from "../src/v1/workflow/models/outbound-invoice.model";

describe("Complete Outbound Job & Inbound Webhook Pipeline Tests", () => {
  let app: any;
  const testTenantId = "TES-1056-6B20";
  const webhookPath = "outbound-test-webhook";
  const jobRegistry: Record<string, Function> = {};

  let originalDefine: any;
  let originalNow: any;
  let originalSchedule: any;

  beforeAll(async () => {
    await connectMongo();

    originalDefine = agenda.define.bind(agenda);
    originalNow = agenda.now.bind(agenda);
    originalSchedule = agenda.schedule.bind(agenda);

    agenda.define = ((name: string, fn: any) => {
      jobRegistry[name] = fn;
      return originalDefine(name, fn);
    }) as any;

    agenda.now = (async (name: string, data: any) => {
      const mockJob: any = {
        attrs: {
          _id: `job_${Date.now()}_${Math.random()}`,
          name,
          data,
        },
        priority: function () {
          return this;
        },
        save: async function () {
          return this;
        },
      };
      const jobFn = jobRegistry[name];
      if (jobFn) {
        setTimeout(async () => {
          try {
            await jobFn(mockJob);
          } catch (err) {
            console.error(`[Job Execution Error in ${name}]:`, err);
          }
        }, 10);
      }
      return mockJob;
    }) as any;

    agenda.schedule = (async (_when: any, name: string, data: any) => {
      return await agenda.now(name, data);
    }) as any;

    registerCompleteOutboundJob();

    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const base64Key = Buffer.from(publicKey).toString("base64");

    await TenantModel.findOneAndUpdate(
      { tenantId: testTenantId },
      {
        $set: {
          tenantId: testTenantId,
          businessName: "Heirs Technologies Limited",
          tin: "61392352-1056",
          businessRegistrationNumber: "RC-61392352",
          contactEmail: "send.info@okeketech.com",
          contactPhone: "+2348012345678",
          password: "hashedpassword123",
          status: TenantStatus.ACTIVE,
          metadata: {
            webhookPath: webhookPath,
          },
          config: {
            erpSystem: "TALLY_ERP",
            webhookEnabled: true,
            invoiceIdKey: "data.invoice_id",
            firsCredentials: {
              serviceId: "34A843BE",
              clientId: encryptSensitiveData(
                "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
              ),
              certificate: encryptSensitiveData("CERT-FIRS-1056"),
              publicKey: encryptSensitiveData(base64Key),
            },
            erpSyncConfig: {
              enabled: false,
            },
          },
        },
      },
      { upsert: true },
    );

    await EventRoutingModel.findOneAndUpdate(
      { tenantId: testTenantId },
      {
        $set: {
          tenantId: testTenantId,
          routes: [
            {
              routeId: "route_invoice_submitted",
              event: "erp.invoice.submitted",
              actions: ["complete_outbound"],
              enabled: true,
            },
          ],
        },
      },
      { upsert: true },
    );

    app = new Elysia().use(errorHandlerMiddleware).use(v1Routes);
  }, 30000);

  beforeEach(async () => {
    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const base64Key = Buffer.from(publicKey).toString("base64");

    await TenantModel.findOneAndUpdate(
      { tenantId: testTenantId },
      {
        $set: {
          tenantId: testTenantId,
          businessName: "Heirs Technologies Limited",
          tin: "61392352-1056",
          businessRegistrationNumber: "RC-61392352",
          contactEmail: "send.info@okeketech.com",
          contactPhone: "+2348012345678",
          password: "hashedpassword123",
          status: TenantStatus.ACTIVE,
          metadata: {
            webhookPath: webhookPath,
          },
          config: {
            erpSystem: "TALLY_ERP",
            webhookEnabled: true,
            invoiceIdKey: "data.invoice_id",
            firsCredentials: {
              serviceId: "34A843BE",
              clientId: encryptSensitiveData(
                "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
              ),
              certificate: encryptSensitiveData("CERT-FIRS-1056"),
              publicKey: encryptSensitiveData(base64Key),
            },
            erpSyncConfig: {
              enabled: false,
            },
          },
        },
      },
      { upsert: true },
    );
  });

  afterAll(async () => {
    agenda.define = originalDefine;
    agenda.now = originalNow;
    agenda.schedule = originalSchedule;
  });

  it("should process inbound invoice webhook end-to-end through complete-outbound job", async () => {
    const uniqueInvoiceId = crypto.randomUUID();
    const uniqueRef = "882-D-701-" + Math.floor(Math.random() * 1000000);

    const invoicePayload = {
      event: "erp.invoice.submitted",
      eventType: "erp.invoice.submitted",
      timestamp: new Date().toISOString(),
      webhook_id: crypto.randomUUID(),
      data: {
        business_id: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
        invoice_id: uniqueInvoiceId,
        invoice_number: uniqueRef,
        issue_date: "2026-08-18",
        invoice_type_code: "380",
        invoice_kind: "B2B",
        payment_status: "PENDING",
        document_currency_code: "NGN",
        accounting_supplier_party: {
          party_name: "Heirs Technologies Limited",
          tin: "61392352-1056",
          email: "send.info@okeketech.com",
          telephone: "+2348012345678",
          business_description: "Technology Services",
          postal_address: {
            state: "Lagos",
            country: "NG",
            city_name: "Lagos",
            postal_zone: "1234567",
            street_name: "123 Business Street",
          },
        },
        accounting_customer_party: {
          party_name: "Heirs Technologies Customer",
          tin: "61392352-1056",
          email: "send.info@okeketech.com",
          telephone: "+2348163565148",
          business_description: "Technology Services",
          postal_address: {
            country: "NG",
            city_name: "Apapa-NG-LA",
            postal_zone: "100001",
            street_name: "24/74, Uzor Street.",
          },
        },
        legal_monetary_total: {
          line_extension_amount: 25000000,
          tax_exclusive_amount: 25000000,
          tax_inclusive_amount: 26875000,
          payable_amount: 26875000,
        },
        invoice_line: [
          {
            hsn_code: "8471.00",
            product_category: "Digital Marketing Services",
            invoiced_quantity: 1,
            line_extension_amount: 25000000,
            item: {
              name: "Software Consulting Services",
              description: "Consulting and development services",
              sellers_item_identification: "",
            },
            price: {
              price_amount: 25000000,
              base_quantity: 1,
              price_unit: "H87",
            },
          },
        ],
        tax_total: [
          {
            tax_amount: 1875000,
            tax_subtotal: [
              {
                taxable_amount: 25000000,
                tax_amount: 1875000,
                tax_category: {
                  id: "STANDARD_VAT",
                  percent: 7.5,
                },
              },
            ],
          },
        ],
      },
    };

    const res = await app.handle(
      new Request(`http://localhost/v1/webhook/inbound/${webhookPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-event-type": "erp.invoice.submitted",
        },
        body: JSON.stringify(invoicePayload),
      }),
    );

    expect(res.status).toBe(200);
    const resJson = await res.json();
    expect(resJson.success).toBe(true);
    const eventId = resJson.data.eventId;

    let deliveredInvoice: any = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      deliveredInvoice = await OutboundInvoiceModel.findOne({
        tenantId: testTenantId,
        erpInvoiceId: uniqueInvoiceId,
      }).exec();

      if (
        deliveredInvoice &&
        deliveredInvoice.status === OutboundInvoiceStatus.DELIVERED &&
        deliveredInvoice.workflowState?.delivered === true
      ) {
        break;
      }
    }

    expect(deliveredInvoice).not.toBeNull();
    expect(deliveredInvoice.status).toBe(OutboundInvoiceStatus.DELIVERED);
    expect(deliveredInvoice.workflowState.transformed).toBe(true);
    expect(deliveredInvoice.workflowState.validated).toBe(true);
    expect(deliveredInvoice.workflowState.signed).toBe(true);
    expect(deliveredInvoice.workflowState.transmitted).toBe(true);
    expect(deliveredInvoice.workflowState.delivered).toBe(true);
    expect(deliveredInvoice.qrCode).toBeDefined();
    expect(deliveredInvoice.webhookEvents).toContain(eventId);
  }, 60000);

  it("should support finalize mode when transformedInvoice already exists in context", async () => {
    const irn = `FINALIZE-${Date.now()}-34A843BE-20260818`;
    await OutboundInvoiceModel.findOneAndUpdate(
      { irn },
      {
        $set: {
          irn,
          tenantId: testTenantId,
          businessId: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
          invoiceNumber: "INV-FINALIZE-001",
          status: OutboundInvoiceStatus.SIGNED,
          metadata: {
            firsSignedData: "mock-signed-data-signature",
          },
          workflowState: {
            transformed: true,
            validated: true,
            signed: true,
            transmitted: true,
            delivered: false,
          },
        },
      },
      { upsert: true },
    );

    const completeOutboundJobFn = jobRegistry["workflow:complete-outbound"];
    expect(completeOutboundJobFn).toBeDefined();

    const mockJob: any = {
      attrs: {
        _id: "job_finalize_test_01",
        data: {
          jobChainId: "job-chain-finalize-test",
          tenantId: testTenantId,
          actions: ["complete_outbound"],
          stepIndex: 0,
          authContext: {
            tenantId: testTenantId,
            businessId: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
          },
          context: {
            irn,
            transformedInvoice: { irn },
          },
        },
      },
      priority: () => mockJob,
      save: () => Promise.resolve(mockJob),
    };

    await completeOutboundJobFn(mockJob);

    const finalizedDoc = await OutboundInvoiceModel.findOne({ irn }).exec();
    expect(finalizedDoc).not.toBeNull();
    expect(finalizedDoc?.status).toBe(OutboundInvoiceStatus.DELIVERED);
    expect(finalizedDoc?.workflowState?.delivered).toBe(true);
  });
});
