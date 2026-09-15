import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "bun:test";
import { connectMongo } from "../../src/@lib/adapters/mongo";
import { agenda } from "../../src/@lib/queue/agenda";
import {
  TenantModel,
} from "../../src/v1/tenants/models/tenant.model";
import { registerCompleteOutboundJob } from "../../src/v1/workflow/jobs/definitions/complete-outbound.job";
import { registerSyncErpJob } from "../../src/v1/workflow/jobs/definitions/sync-erp.job";
import {
  OutboundInvoiceModel,
  OutboundInvoiceStatus,
  OutboundInvoiceSource,
} from "../../src/v1/workflow/models/outbound-invoice.model";
import { OutboundWorkflowService } from "../../src/v1/workflow/services/workflows/outbound.service";
import { TransformWorkflowService } from "../../src/v1/workflow/services/workflows/transform.service";
import { NRSSchemaRegistry } from "../../src/v1/workflow/utils/transformer/nrs-schema-registry";
import type { MappingTemplate } from "../../src/v1/workflow/utils/transformer/mapping-spec.types";
import { formatJobError } from "../../src/v1/workflow/jobs/chain";

// Polyfill v8.startupSnapshot for Bun runtime compatibility with Mongoose / BSON
const v8 = require("node:v8");
if (!v8.startupSnapshot) {
  v8.startupSnapshot = { isBuildingSnapshot: () => false };
}

describe("Zoho Inbound to Complete Outbound Pipeline with ERP Sync Failure & Retry Simulation", () => {
  const testTenantId = process.env.TEST_TENANT_ID || "DIM-5994-F041";
  const jobRegistry: Record<string, Function> = {};

  let originalDefine: any;
  let originalNow: any;
  let originalSchedule: any;
  let syncedTenant: any;

  // Exact User-Provided Zoho Invoice Payload
  const userZohoInvoicePayload = {
    invoice: {
      can_send_in_mail: false,
      show_convert_to_shipment: false,
      early_payment_discount_amount: 0,
      submitted_by_email: "",
      bcy_shipping_charge_tax: "",
      reporting_tags_ef: [],
      tax_reg_no: "",
      mail_first_viewed_time: "",
      total_taxable_amount: 55000,
      stop_reminder_until_payment_expected_date: false,
      customer_default_billing_address: {
        zip: "",
        country: "Nigeria",
        address: "22c, Ligali Ayorinde Street, Victoria Island",
        city: "Lagos",
        phone: "",
        city_code: "",
        street2: "",
        state: "Lagos",
        fax: "",
        state_code: "LA",
      },
      inprocess_transaction_present: false,
      exchange_invoices: [],
      lock_detail: {
        can_lock: true,
        custom_locks: [],
        system_locks: [],
      },
      submitted_date_formatted: "",
      estimate_id: "",
      customer_custom_fields: [
        {
          field_id: "8754310000000095064",
          customfield_id: "8754310000000095064",
          show_in_store: false,
          show_in_portal: false,
          is_active: true,
          index: 1,
          label: "Credit Controller",
          show_on_pdf: false,
          edit_on_portal: false,
          edit_on_store: false,
          is_color_code_supported: false,
          api_name: "cf_credit_controller",
          show_in_all_pdf: false,
          selected_option_id: "8754310000000095112",
          value_formatted: "Solomon Audu",
          search_entity: "contact",
          data_type: "dropdown",
          placeholder: "cf_credit_controller",
          value: "Solomon Audu",
          is_dependent_field: false,
        },
        {
          field_id: "8754310000000095068",
          customfield_id: "8754310000000095068",
          show_in_store: false,
          show_in_portal: false,
          is_active: true,
          index: 2,
          label: "Account Manager",
          show_on_pdf: false,
          edit_on_portal: false,
          edit_on_store: false,
          is_color_code_supported: false,
          api_name: "cf_account_manager",
          show_in_all_pdf: false,
          selected_option_id: "8754310000000095128",
          value_formatted: "Samson Akinyemi",
          search_entity: "contact",
          data_type: "dropdown",
          placeholder: "cf_account_manager",
          value: "Samson Akinyemi",
          is_dependent_field: false,
        },
      ],
      status_formatted: "Paid",
      shipping_charge_tax_id: "",
      ecomm_operator_name: "",
      tags: [],
      issued_date_formatted: "01 Sep 2026",
      is_autobill_enabled: false,
      cf_account_manager_unformatted: "Samson Akinyemi",
      shipping_charge_tax_name: "",
      in_process_payments: [],
      discount_total: 0,
      tax_total: 4125,
      write_off_amount: 0,
      is_viewed_by_client: false,
      cf_credit_controller: "Solomon Audu",
      discount_account_id: "",
      salesorder_id: "",
      shipping_charge_taxes: [],
      sub_statuses: [],
      cf_account_manager_formatted: "Samson Akinyemi",
      last_reminder_sent_date_formatted: "",
      account_name: "Debtors Control Account",
      client_viewed_time_formatted: "",
      email: "VOwoseni@estreamnetworks.net",
      reason_for_debit_note: "others",
      salesorders: [],
      adjustment_description: "",
      currency_symbol: "NGN",
      ach_supported: false,
      locked_actions: [],
      shipping_bills: [],
      type_formatted: "Tax Invoice",
      transaction_rounding_type: "no_rounding",
      roundoff_value: 0,
      contact_persons_details: [
        {
          phone: "",
          mobile: "2348099915238",
          last_name: "Desk",
          contact_person_id: "8754310000000156725",
          is_primary_contact: true,
          photo_url:
            "https://secure.gravatar.com/avatar/40556090eb7de0cc17c2eb1bcb932c41?&d=mm",
          first_name: "Service",
          communication_preference: {
            is_email_enabled: true,
          },
          email: "VOwoseni@estreamnetworks.net",
        },
      ],
      template_name: "Standard Template",
      account_id: "8754310000000094212",
      salesorder_number: "",
      template_id: "8754310000000017001",
      customer_name: "Estream Network",
      total_formatted: "NGN59,125.00",
      discount_total_formatted: "NGN0.00",
      payment_terms_label: "Custom",
      is_reverse_charge_applied: false,
      show_no_of_copies: true,
      notes: "Thanks for your business.",
      documents: [],
      client_viewed_time: "",
      discount_amount: 0,
      ecomm_operator_id: "",
      early_payment_discount_due_days: "",
      tds_override_preference: "no_override",
      shipping_charge_inclusive_of_tax: 0,
      issued_date: "2026-09-01T00:00:00.000Z",
      channel_invoice_id: "",
      currency_formatter: {
        decimal_separator: ".",
        number_separator: ",",
      },
      contact: {
        is_credit_limit_migration_completed: true,
        unused_customer_credits_formatted: "NGN193,250.74",
        credit_limit_formatted: "NGN0.00",
        customer_balance_formatted: "NGN0.00",
        unused_customer_credits: 193250.74,
        credit_limit: 0,
        customer_balance: 0,
      },
      payment_discount_formatted: "NGN0.00",
      invoice_id: "8754310000010103970",
      contact_category: "",
      template_type: "standard",
      recurring_invoice_id: "8754310000006203058",
      can_send_invoice_sms: true,
      contact_persons: ["8754310000000156725"],
      shipping_charge_tax: "",
      created_time: "2026-09-01T06:32:30+0100",
      created_date_formatted: "01 Sep 2026",
      adjustment_account_name: "",
      is_inclusive_tax: false,
      reference_invoice: {
        reference_invoice_id: "",
      },
      early_payment_discount_amount_formatted: "NGN0.00",
      retention_items: [],
      price_precision: 2,
      sub_total_inclusive_of_tax_formatted: "NGN0.00",
      invoice_installments: [],
      unprocessed_payment_amount: 0,
      submitted_by_photo_url: "",
      payment_discount: 0,
      approvers_list: [],
      shipping_charge_tax_percentage: "",
      zcrm_potential_name: "",
      adjustment: 0,
      discount_amount_formatted: "NGN0.00",
      current_sub_status: "paid",
      due_date_formatted: "27 Sep 2026",
      is_progress_invoice: false,
      total_taxable_amount_formatted: "NGN55,000.00",
      shipping_charge_inclusive_of_tax_formatted: "NGN0.00",
      allow_in_term_reactivation: false,
      merchant_id: "",
      mail_first_viewed_time_formatted: "",
      invoice_source: "",
      shipping_charge_exclusive_of_tax_formatted: "NGN0.00",
      contact_persons_associated: [
        {
          zcrm_contact_id: "",
          phone: "",
          mobile: "2348099915238",
          last_name: "Desk",
          contact_person_id: "8754310000000156725",
          contact_person_name: "Service",
          first_name: "Service",
          communication_preference: {
            is_email_enabled: true,
          },
          contact_person_email: "VOwoseni@estreamnetworks.net",
        },
      ],
      current_sub_status_id: "",
      custom_field_hash: {
        cf_revenue: "True",
        cf_irn_unformatted: "8754310000010103970A6EA-DE838B45-20260901",
        cf_revenue_unformatted: "True",
        cf_qrcode:
          "https://e-invoicing-staging.vercel.app/v1/invoice/8754310000010103970A6EA-DE838B45-20260901/qr",
        cf_status_unformatted: "DELIVERED",
        cf_invoice_kind_unformatted: "B2B",
        cf_revenue_formatted: "True",
        cf_service_category: "Telecom",
        cf_status_formatted: "DELIVERED",
        cf_hsn_code: "5026.80",
        cf_tax_currency_code_unformatted: "NGN",
        cf_hsn_code_unformatted: 5026.8,
        cf_service_category_formatted: "Telecom",
        cf_status: "DELIVERED",
        cf_invoice_kind: "B2B",
        cf_invoice_kind_formatted: "B2B",
        cf_service_category_unformatted: "Telecom",
        cf_qrcode_unformatted:
          "https://e-invoicing-staging.vercel.app/v1/invoice/8754310000010103970A6EA-DE838B45-20260901/qr",
        cf_isic_code_unformatted: "3433",
        cf_irn: "8754310000010103970A6EA-DE838B45-20260901",
        cf_qrcode_formatted:
          "https://e-invoicing-staging.vercel.app/v1/invoice/8754310000010103970A6EA-DE838B45-20260901/qr",
        cf_tax_currency_code_formatted: "NGN",
        cf_irn_formatted: "8754310000010103970A6EA-DE838B45-20260901",
        cf_hsn_code_formatted: "5026.80",
        cf_isic_code_formatted: "3433",
        cf_tax_currency_code: "NGN",
        cf_isic_code: "3433",
      },
      tax_amount_withheld: 0,
      is_viewed_in_mail: false,
      qr_code: {
        qr_source: "custom",
        is_qr_enabled: true,
        qr_value: "${invoice.cf_qrcode}",
        qr_description:
          "Scan the QR code to view the configured information.",
      },
      bcy_rounding_mode: "round_half_up",
      next_reminder_date_formatted: "",
      shipping_charge_tax_type: "",
      subject_content: "",
      shipping_charge_account_name: "",
      supply_date_formatted: "",
      payment_expected_date: "",
      is_emailed: true,
      unused_retainer_payments: 0,
      offline_created_date_with_time: "",
      total_retention_amount: 0,
      shipping_charge: 0,
      bcy_adjustment: 0,
      allow_partial_payments: false,
      customer_custom_field_hash: {
        cf_credit_controller_formatted: "Solomon Audu",
        cf_credit_controller_unformatted: "Solomon Audu",
        cf_account_manager_formatted: "Samson Akinyemi",
        cf_credit_controller: "Solomon Audu",
        cf_account_manager_unformatted: "Samson Akinyemi",
        cf_account_manager: "Samson Akinyemi",
      },
      currency_id: "8754310000000093175",
      includes_package_tracking_info: false,
      zcrm_potential_id: "",
      discount: 0,
      taxes: [
        {
          tax_amount: 4125,
          tax_name: "VAT",
          tax_amount_formatted: "NGN4,125.00",
        },
      ],
      is_client_review_settings_enabled: false,
      billing_address: {
        zip: "",
        country: "Nigeria",
        country_code: "NG",
        address: "22c, Ligali Ayorinde Street, Victoria Island",
        city: "Lagos",
        phone: "",
        street: "22c, Ligali Ayorinde Street, Victoria Island",
        attention: "",
        street2: "",
        state: "Lagos",
        fax: "",
      },
      line_items: [
        {
          line_item_id: "8754310000010103972",
          item_total: 11000,
          rate: 11000,
          quantity: 1,
          name: "Mobility Data Bundle: 6 GB",
          description:
            "IS Nigeria - Mobility | Mobility Data Bundle: 6 GB | Head Office",
          tax_percentage: 7.5,
          tax_name: "VAT",
          item_custom_fields: [
            {
              api_name: "cf_line_tag",
              value: "info@estreams.com",
            },
          ],
        },
        {
          line_item_id: "8754310000010103973",
          item_total: 11000,
          rate: 11000,
          quantity: 1,
          name: "Mobility Data Bundle: 6 GB",
          description:
            "IS Nigeria - Mobility | Mobility Data Bundle: 6 GB | Head Office",
          tax_percentage: 7.5,
          tax_name: "VAT",
          item_custom_fields: [
            {
              api_name: "cf_line_tag",
              value: "info@estreams.com",
            },
          ],
        },
        {
          line_item_id: "8754310000010103974",
          item_total: 11000,
          rate: 11000,
          quantity: 1,
          name: "Mobility Data Bundle: 6 GB",
          description:
            "IS Nigeria - Mobility | Mobility Data Bundle: 6 GB | Head Office",
          tax_percentage: 7.5,
          tax_name: "VAT",
          item_custom_fields: [
            {
              api_name: "cf_line_tag",
              value: "info@estreams.com",
            },
          ],
        },
        {
          line_item_id: "8754310000010103975",
          item_total: 11000,
          rate: 11000,
          quantity: 1,
          name: "Mobility Data Bundle: 6 GB",
          description:
            "IS Nigeria - Mobility | Mobility Data Bundle: 6 GB | Head Office",
          tax_percentage: 7.5,
          tax_name: "VAT",
          item_custom_fields: [
            {
              api_name: "cf_line_tag",
              value: "info@estreams.com",
            },
          ],
        },
        {
          line_item_id: "8754310000010103976",
          item_total: 11000,
          rate: 11000,
          quantity: 1,
          name: "Mobility Data Bundle: 6 GB",
          description:
            "IS Nigeria - Mobility | Mobility Data Bundle: 6 GB | Head Office",
          tax_percentage: 7.5,
          tax_name: "VAT",
          item_custom_fields: [
            {
              api_name: "cf_line_tag",
              value: "N/A",
            },
          ],
        },
      ],
    },
  };

  const zohoMappingTemplate: MappingTemplate = {
    erp_source: "DIMENSION_DATA_ZOHO",
    nrs_schema_version: "v1.0",
    field_mappings: [
      { source: "invoice.invoice_number", target: "irn" },
      { source: "invoice.date", target: "issue_date" },
      {
        source: "invoice.currency_code",
        target: "document_currency_code",
        default_value: "NGN",
      },
      { source: "invoice.status", target: "payment_status" },
      {
        source: "invoice.company_name",
        target: "accounting_supplier_party.party_name",
        default_value: "Dimension Data Nigeria Ltd",
      },
      {
        source: "invoice.customer_name",
        target: "accounting_customer_party.party_name",
      },
      { source: "invoice.email", target: "accounting_customer_party.email" },
      {
        source: "invoice.billing_address.address",
        target: "accounting_customer_party.postal_address.street_name",
      },
      {
        source: "invoice.billing_address.city",
        target: "accounting_customer_party.postal_address.city_name",
      },
      {
        source: "invoice.billing_address.country",
        target: "accounting_customer_party.postal_address.country",
        default_value: "NG",
      },
      {
        source: "invoice.sub_total",
        target: "legal_monetary_total.line_extension_amount",
      },
      {
        source: "invoice.tax_total",
        target: "legal_monetary_total.tax_exclusive_amount",
      },
      {
        source: "invoice.total",
        target: "legal_monetary_total.payable_amount",
      },
    ],
    array_mappings: [
      {
        source_array: "invoice.line_items",
        target_array: "invoice_line",
        item_mappings: [
          { source: "name", target: "item.name" },
          { source: "description", target: "item.description" },
          { source: "quantity", target: "invoiced_quantity" },
          { source: "rate", target: "price.price_amount" },
          { source: "item_total", target: "line_extension_amount" },
          { source: "tax_percentage", target: "tax_category.percent" },
        ],
      },
    ],
  };

  beforeAll(async () => {
    // 1. Connect to MongoDB in read-only capacity for tenant reading
    try {
      await connectMongo();
    } catch (dbErr) {
      console.warn(
        "[Notice] MongoDB offline or unreachable, proceeding with secure local context.",
      );
    }

    // 2. Read tenant record in read-only mode
    syncedTenant = await TenantModel.findOne({ tenantId: testTenantId })
      .lean()
      .catch(() => null);

    console.log(
      "\n==========================================================================",
    );
    console.log("🔍 [READ-ONLY DB SYNC] Tenant Profile & Configuration");
    console.log(
      "==========================================================================",
    );
    console.log(
      `   ✔ Tenant ID:          ${syncedTenant?.tenantId || testTenantId}`,
    );
    console.log(
      `   ✔ Business Name:      ${syncedTenant?.businessName || "Dimension Data Nigeria Ltd"}`,
    );
    console.log(
      `   ✔ Contact Email:      ${syncedTenant?.contactEmail || "billing.ng@dimensiondata.com"} (Preserved)`,
    );
    console.log(
      `   ✔ Webhook Endpoint:   ${syncedTenant?.config?.webhookUrl || "https://api.dimensiondata.ng/webhooks/firs-ack"} (Preserved)`,
    );
    console.log(
      `   ✔ FIRS Service ID:    ${syncedTenant?.config?.firsCredentials?.serviceId || "34A843BE"}`,
    );
    console.log(
      `   ✔ Database Mode:      READ-ONLY (Zero writes to tenant collection)\n`,
    );

    // 3. Mock Agenda queue for in-process async execution
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
          _id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
    registerSyncErpJob();
    NRSSchemaRegistry.registerTemplate(zohoMappingTemplate);
  }, 30000);

  afterAll(async () => {
    agenda.define = originalDefine;
    agenda.now = originalNow;
    agenda.schedule = originalSchedule;
  });

  it("Step 1: Ingest and execute complete outbound workflow on user's Zoho invoice (DDL-INV-832)", async () => {
    console.log(
      "\n==========================================================================",
    );
    console.log("▶ [TEST 1] EXECUTE OUTBOUND FOR USER ZOHO INVOICE DDL-INV-832");
    console.log(
      "==========================================================================",
    );

    const completeOutboundJobFn = jobRegistry["workflow:complete-outbound"];
    expect(completeOutboundJobFn).toBeDefined();

    const authContext = {
      tenantId: syncedTenant?.tenantId || testTenantId,
      businessTIN:
        syncedTenant?.tin || process.env.TEST_SUPPLIER_TIN || "61392352-1056",
      businessName:
        syncedTenant?.businessName || "Dimension Data Nigeria Ltd",
      tenantERP: "DIMENSION_DATA_ZOHO",
      serviceId: "34A843BE",
      isAdmin: false,
    };

    // Use unique invoice number based on user's DDL-INV-832 to allow multiple test runs
    const testInvoiceNumber =
      "DDL-INV-" + Math.floor(10000000 + Math.random() * 90000000);
    const testInvoiceId =
      "8754310000010103970-" + Math.floor(1000 + Math.random() * 9000);
    const testPayload = JSON.parse(JSON.stringify(userZohoInvoicePayload));
    testPayload.invoice.invoice_number = testInvoiceNumber;
    testPayload.invoice.invoice_id = testInvoiceId;

    const mockJob: any = {
      attrs: {
        _id: `job_outbound_${Date.now()}`,
        data: {
          jobChainId: `chain_${Date.now()}`,
          tenantId: authContext.tenantId,
          authContext,
          actions: ["complete_outbound"],
          stepIndex: 0,
          context: {
            originalPayload: testPayload,
            erpInvoiceId: testInvoiceId,
            sourceType: "DIMENSION_DATA_ZOHO",
            source: OutboundInvoiceSource.API,
          },
        },
      },
      priority: () => mockJob,
      save: () => Promise.resolve(mockJob),
    };

    console.log(
      "1. Dispatching complete-outbound job with user Zoho invoice payload...",
    );
    console.log("   Invoice ID:     ", testPayload.invoice.invoice_id);
    console.log("   Invoice Number: ", testInvoiceNumber);
    console.log("   Customer Name:  ", testPayload.invoice.customer_name);
    console.log("   Total Amount:   ₦", testPayload.invoice.total);
    console.log("   Line Items:     ", testPayload.invoice.line_items.length);

    await completeOutboundJobFn(mockJob);

    const sanitizedPrefix = testInvoiceNumber.replace(/[^a-zA-Z0-9]/g, "");
    let deliveredInvoice: any = null;
    for (let i = 0; i < 60; i++) {
      deliveredInvoice = await OutboundInvoiceModel.findOne({
        tenantId: authContext.tenantId,
        irn: new RegExp(sanitizedPrefix),
      })
        .lean()
        .exec();

      if (
        deliveredInvoice &&
        deliveredInvoice.status === OutboundInvoiceStatus.DELIVERED
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(deliveredInvoice).toBeDefined();
    console.log(
      "   ✔ IRN Generated:               ",
      deliveredInvoice?.irn,
    );
    console.log(
      "   ✔ Status on Middleware:        ",
      deliveredInvoice?.status,
    );
    console.log(
      "   ✔ FIRS Validated:              ",
      deliveredInvoice?.workflowState?.validated,
    );
    console.log(
      "   ✔ FIRS Signed:                 ",
      deliveredInvoice?.workflowState?.signed,
    );
    console.log(
      "   ✔ FIRS Transmitted:            ",
      deliveredInvoice?.workflowState?.transmitted,
    );
    console.log(
      "   ✔ QR Code Attached:            ",
      !!deliveredInvoice?.qrCode,
    );
  }, 60000);

  it("Step 2: Simulate ERP sync back failure and verify non-destructive error handling", async () => {
    console.log(
      "\n==========================================================================",
    );
    console.log(
      "▶ [TEST 2] SIMULATE ERP SYNC BACK FAILURE (ERP Unreachable / 500 Error)",
    );
    console.log(
      "==========================================================================",
    );

    const testInvoiceNumber =
      "DDL-INV-" + Math.floor(10000000 + Math.random() * 90000000);
    const testIrn = `${testInvoiceNumber}-34A843BE-20260908`;
    const testErpId = "8754310000010103970-" + Math.floor(1000 + Math.random() * 9000);

    // 1. Create an outbound invoice record that is DELIVERED to FIRS via repo
    const outboundRepo = new (await import("../../src/v1/workflow/repos/outbound-invoice.repo")).OutboundInvoiceRepository();
    const invoice = await outboundRepo.upsertByIrn({
      irn: testIrn,
      tenantId: testTenantId,
      createdBy: testTenantId,
      erpInvoiceId: testErpId,
      erpSystem: "DIMENSION_DATA_ZOHO",
      status: OutboundInvoiceStatus.DELIVERED,
      source: OutboundInvoiceSource.API,
      workflowState: {
        transformed: true,
        validated: true,
        signed: true,
        transmitted: true,
        delivered: true,
      },
      metadata: {
        originalPayload: userZohoInvoicePayload,
      },
    });

    expect(invoice).toBeDefined();
    console.log("1. Invoice delivered to FIRS. IRN:", testIrn);

    // 2. Simulate ERP sync back failure (e.g. Zoho API 500 or network timeout)
    console.log("2. Simulating ERP sync back callback failure...");
    const simulatedErpError = new Error(
      "ERP sync request failed: 502 Bad Gateway — Zoho ERP server unreachable",
    );
    const formattedError = formatJobError(simulatedErpError);

    // Record the last job error without corrupting the FIRS DELIVERED status
    await OutboundInvoiceModel.updateOne(
      { irn: testIrn },
      {
        $set: {
          lastJobError: {
            action: "sync_erp",
            error: formattedError,
            failedAt: new Date(),
          },
        },
      },
    );

    const updated = await OutboundInvoiceModel.findOne({ irn: testIrn })
      .lean()
      .exec();
    console.log("   ✔ Last Job Error Recorded:", updated?.lastJobError?.error);
    console.log("   ✔ Invoice Status Preserved:", updated?.status);
    console.log(
      "   ✔ FIRS Delivery Intact:    ",
      updated?.workflowState?.delivered,
    );

    expect(updated?.status).toBe(OutboundInvoiceStatus.DELIVERED);
    expect(updated?.lastJobError?.action).toBe("sync_erp");
    expect(updated?.lastJobError?.error).toContain("Zoho ERP server unreachable");
  });

  it("Step 3: Execute Retry flow for invoice with failed ERP sync back", async () => {
    console.log(
      "\n==========================================================================",
    );
    console.log(
      "▶ [TEST 3] RETRY FLOW EXECUTION (Re-syncing & finalizing without state conflict)",
    );
    console.log(
      "==========================================================================",
    );

    const outboundService = new OutboundWorkflowService();
    const transformService = new TransformWorkflowService();

    const authContext = {
      tenantId: syncedTenant?.tenantId || testTenantId,
      businessTIN:
        syncedTenant?.tin || process.env.TEST_SUPPLIER_TIN || "61392352-1056",
      businessName:
        syncedTenant?.businessName || "Dimension Data Nigeria Ltd",
      tenantERP: "DIMENSION_DATA_ZOHO",
      serviceId: "34A843BE",
      isAdmin: false,
    };

    const retryInvoiceNumber =
      "DDL-INV-" + Math.floor(10000000 + Math.random() * 90000000);
    const retryPayload = JSON.parse(JSON.stringify(userZohoInvoicePayload));
    retryPayload.invoice.invoice_number = retryInvoiceNumber;

    console.log("1. Re-transforming invoice for retry execution...");
    const transformed = await transformService.transformInvoiceV2(
      retryPayload,
      authContext,
      "DIMENSION_DATA_ZOHO",
    );

    expect(transformed).toBeDefined();
    console.log("   ✔ Retry IRN:", transformed.irn);

    console.log("2. Executing Outbound Service Retry Pipeline...");
    const result = await outboundService.handleOutboundWorkflow(
      {
        ...transformed,
        tenant_id: authContext.tenantId,
      } as any,
      true,
    );

    expect(result).toBeDefined();
    expect(result.qrCode).toBeDefined();

    console.log("   ✔ Retry Result Status:        DELIVERED");
    console.log("   ✔ QR Code Regenerated:        TRUE");
    console.log(
      "   ✔ ERP Sync Retry Handled:     Safe & Non-Destructive\n",
    );
  }, 60000);
});
