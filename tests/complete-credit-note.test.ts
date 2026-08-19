import { describe, it, expect, mock, beforeAll, afterAll, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import crypto from "crypto";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { encryptSensitiveData } from "../src/@lib/crypto";
import { v1Routes } from "../src/v1";
import { errorHandlerMiddleware } from "../src/middlewares";
import { TenantModel, TenantStatus } from "../src/v1/tenants/models/tenant.model";
import { EventRoutingModel } from "../src/v1/admin/models/event-routing.model";
import {
  OutboundInvoiceModel,
  OutboundInvoiceStatus,
} from "../src/v1/workflow/models/outbound-invoice.model";
import { registerCompleteCreditNoteJob } from "../src/v1/workflow/jobs/definitions/complete-credit-note.job";
import { agenda } from "../src/@lib/queue/agenda";

describe("Complete Credit Note Job & Inbound Webhook Pipeline Tests", () => {
  let app: any;
  const testTenantId = "TES-1056-6B20";
  const webhookPath = "credit-note-test-webhook";
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
            console.error(`[Credit Note Job Execution Error in ${name}]:`, err);
          }
        }, 10);
      }
      return mockJob;
    }) as any;

    agenda.schedule = (async (_when: any, name: string, data: any) => {
      return await agenda.now(name, data);
    }) as any;

    registerCompleteCreditNoteJob();

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
            idKeyMap: {
              erp_creditnote_issued: "data.invoice_id",
            },
            referenceIdKeyMap: {
              erp_creditnote_issued: "data.billing_reference[0]",
            },
            firsCredentials: {
              serviceId: "34A843BE",
              clientId: encryptSensitiveData("a6de8bd8-43be-47b9-80a5-988ee3fb9cea"),
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
              routeId: "route_creditnote_issued",
              event: "erp.creditnote.issued",
              actions: ["complete_credit_note"],
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
            idKeyMap: {
              erp_creditnote_issued: "data.invoice_id",
            },
            referenceIdKeyMap: {
              erp_creditnote_issued: "data.billing_reference[0]",
            },
            firsCredentials: {
              serviceId: "34A843BE",
              clientId: encryptSensitiveData("a6de8bd8-43be-47b9-80a5-988ee3fb9cea"),
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

  it("should process inbound credit note webhook end-to-end and deliver credit note", async () => {
    // 1. Seed an original invoice in MongoDB to be referenced
    const originalInvoiceRef = "882-D-701-" + Math.floor(Math.random() * 1000000);
    const originalIrn = `${originalInvoiceRef.replace(/[^a-zA-Z0-9]/g, "")}-34A843BE-20260818`;

    await OutboundInvoiceModel.findOneAndUpdate(
      { irn: originalIrn },
      {
        $set: {
          irn: originalIrn,
          tenantId: testTenantId,
          businessId: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
          invoiceNumber: originalInvoiceRef,
          status: OutboundInvoiceStatus.DELIVERED,
          workflowState: {
            transformed: true,
            validated: true,
            signed: true,
            transmitted: true,
            delivered: true,
          },
          metadata: {
            transformedInvoice: {
              accounting_supplier_party: {
                tin: "61392352-1056",
                party_name: "Heirs Technologies Limited",
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
                tin: "61392352-1056",
                party_name: "Heirs Technologies Customer",
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
            },
          },
        },
      },
      { upsert: true },
    );

    const creditNoteInvoiceId = crypto.randomUUID();
    const creditNoteRef = "882-D-701-CN-" + Math.floor(Math.random() * 1000000);

    const creditNotePayload = {
      event: "erp.creditnote.issued",
      eventType: "erp.creditnote.issued",
      timestamp: new Date().toISOString(),
      webhook_id: crypto.randomUUID(),
      data: {
        business_id: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
        invoice_id: creditNoteInvoiceId,
        invoice_number: creditNoteRef,
        issue_date: "2026-08-18",
        invoice_type_code: "381",
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
        billing_reference: [
          {
            irn: originalIrn,
            issue_date: "2026-08-18",
          },
        ],
        legal_monetary_total: {
          line_extension_amount: 5000000,
          tax_exclusive_amount: 5000000,
          tax_inclusive_amount: 5375000,
          payable_amount: 5375000,
        },
        invoice_line: [
          {
            hsn_code: "8471.00",
            product_category: "Digital Marketing Services",
            invoiced_quantity: 1,
            line_extension_amount: 5000000,
            item: {
              name: "Software Consulting Partial Refund",
              description: "Scope adjustment credit",
              sellers_item_identification: "",
            },
            price: {
              price_amount: 5000000,
              base_quantity: 1,
              price_unit: "H87",
            },
          },
        ],
        tax_total: [
          {
            tax_amount: 375000,
            tax_subtotal: [
              {
                taxable_amount: 5000000,
                tax_amount: 375000,
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
          "x-event-type": "erp.creditnote.issued",
        },
        body: JSON.stringify(creditNotePayload),
      }),
    );

    expect(res.status).toBe(200);
    const resJson = await res.json();
    expect(resJson.success).toBe(true);

    let deliveredCreditNote: any = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      deliveredCreditNote = await OutboundInvoiceModel.findOne({
        tenantId: testTenantId,
        erpInvoiceId: creditNoteInvoiceId,
      }).exec();

      if (
        deliveredCreditNote &&
        deliveredCreditNote.status === OutboundInvoiceStatus.DELIVERED &&
        deliveredCreditNote.workflowState?.delivered === true
      ) {
        break;
      }
    }

    expect(deliveredCreditNote).not.toBeNull();
    expect(deliveredCreditNote.status).toBe(OutboundInvoiceStatus.DELIVERED);
    expect(deliveredCreditNote.workflowState.delivered).toBe(true);
    expect(
      deliveredCreditNote.metadata.transformedInvoice.invoice_type_code,
    ).toBe("381");
    expect(
      deliveredCreditNote.metadata.transformedInvoice.billing_reference[0].irn,
    ).toBe(originalIrn);
  }, 60000);

  it("should fail cleanly when billing reference is missing in credit note payload", async () => {
    const completeCreditNoteJobFn =
      jobRegistry["workflow:complete-credit-note"];
    expect(completeCreditNoteJobFn).toBeDefined();

    const mockJob: any = {
      attrs: {
        _id: "job_credit_note_fail_test",
        data: {
          jobChainId: "job-chain-fail-test",
          tenantId: testTenantId,
          eventType: "erp.creditnote.issued",
          actions: ["complete_credit_note"],
          stepIndex: 0,
          authContext: {
            tenantId: testTenantId,
            businessId: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
          },
          context: {
            originalPayload: {
              invoice_id: "missing-ref-cn-id",
              // No billing_reference provided
            },
          },
        },
      },
      priority: () => mockJob,
      save: () => Promise.resolve(mockJob),
    };

    await expect(completeCreditNoteJobFn(mockJob)).rejects.toThrow(
      "Missing billing reference or reference ID",
    );
  });
});
