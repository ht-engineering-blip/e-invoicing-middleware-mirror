import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "crypto";
import { Elysia } from "elysia";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { agenda } from "../src/@lib/queue/agenda";
import { errorHandlerMiddleware } from "../src/middlewares";
import { v1Routes } from "../src/v1";
import { TenantModel } from "../src/v1/tenants/models/tenant.model";
import { registerCompleteCreditNoteJob } from "../src/v1/workflow/jobs/definitions/complete-credit-note.job";
import {
  OutboundInvoiceModel,
  OutboundInvoiceStatus,
} from "../src/v1/workflow/models/outbound-invoice.model";

describe("Complete Credit Note Job & Inbound Webhook Pipeline Tests", () => {
  let app: any;
  const testTenantId = process.env.TEST_TENANT_ID;
  let webhookPath: string;
  let syncedTenant: any;
  const jobRegistry: Record<string, Function> = {};

  const testEmail = process.env.TEST_CONTACT_EMAIL;
  const testPassword = process.env.TEST_PASSWORD;
  const testPhone = process.env.TEST_CONTACT_PHONE;
  const testServiceId = process.env.TEST_FIRS_SERVICE_ID;
  const testPublicKey = process.env.TEST_FIRS_PUBLIC_KEY;
  const testCertificate = process.env.TEST_FIRS_CERTIFICATE;
  const testBusinessId = process.env.TEST_BUSINESS_ID;
  const testSupplierTin = process.env.TEST_SUPPLIER_TIN;

  if (
    !testTenantId ||
    !testEmail ||
    !testPassword ||
    !testPhone ||
    !testServiceId ||
    !testPublicKey ||
    !testCertificate ||
    !testBusinessId ||
    !testSupplierTin
  ) {
    throw new Error(
      "Missing required test environment variables. Please check your .env file setup.",
    );
  }

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

    syncedTenant = await TenantModel.findOne({ tenantId: testTenantId }).lean();
    if (!syncedTenant) {
      throw new Error(`Tenant ${testTenantId} not found in database.`);
    }
    webhookPath =
      syncedTenant.metadata?.webhookPath ||
      syncedTenant.config?.webhookPath ||
      "d777027e42ec04006982c85df9737636";

    console.log(
      `\n==========================================================================`,
    );
    console.log(`🔍 [READ-ONLY DB SYNC] Tenant Profile & Configuration`);
    console.log(
      `==========================================================================`,
    );
    console.log(`   ✔ Tenant ID:          ${syncedTenant.tenantId}`);
    console.log(`   ✔ Business Name:      ${syncedTenant.businessName}`);
    console.log(
      `   ✔ Contact Email:      ${syncedTenant.contactEmail} (Preserved, Never Overwritten)`,
    );
    console.log(
      `   ✔ Webhook Endpoint:   ${syncedTenant.metadata?.webhookUrl || syncedTenant.metadata?.webhookPath} (Preserved)`,
    );
    console.log(
      `   ✔ FIRS Service ID:    ${syncedTenant.config?.firsCredentials?.serviceId || "34A843BE"}`,
    );
    console.log(
      `   ✔ Database Mode:      READ-ONLY (Zero writes to tenant or event-routing collections)\n`,
    );

    app = new Elysia().use(errorHandlerMiddleware).use(v1Routes);
  }, 30000);

  afterAll(async () => {
    agenda.define = originalDefine;
    agenda.now = originalNow;
    agenda.schedule = originalSchedule;
  });

  it("should process inbound credit note webhook end-to-end and deliver credit note", async () => {
    // 1. Seed an original invoice in MongoDB to be referenced
    const originalInvoiceRef =
      "882-D-701-" + Math.floor(Math.random() * 1000000);
    const originalIrn = `${originalInvoiceRef.replace(/[^a-zA-Z0-9]/g, "")}-34A843BE-20260818`;

    await OutboundInvoiceModel.findOneAndUpdate(
      { irn: originalIrn },
      {
        $set: {
          irn: originalIrn,
          tenantId: testTenantId,
          businessId: testBusinessId,
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
                tin: testSupplierTin,
                party_name: "Enim itaque",
                email: testEmail,
                telephone: testPhone,
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
                tin: testSupplierTin,
                party_name: "Heirs Technologies Customer",
                email: testEmail,
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
        business_id: testBusinessId,
        invoice_id: creditNoteInvoiceId,
        invoice_number: creditNoteRef,
        issue_date: "2026-08-18",
        invoice_type_code: "381",
        invoice_kind: "B2B",
        payment_status: "PENDING",
        document_currency_code: "NGN",
        accounting_supplier_party: {
          party_name: "Enim itaque",
          tin: testSupplierTin,
          email: testEmail,
          telephone: testPhone,
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
          tin: testSupplierTin,
          email: testEmail,
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
          ...(syncedTenant?.config?.webhookAuth
            ? { "x-webhook-secret": syncedTenant.config.webhookAuth }
            : {}),
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
    ).toBe("380");
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
            businessId: testBusinessId,
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
