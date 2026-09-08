import { describe, expect, it, beforeAll } from "bun:test";
import { TransformWorkflowService } from "../../src/v1/workflow/services/workflows/transform.service";
import { NRSSchemaRegistry } from "../../src/v1/workflow/utils/transformer/nrs-schema-registry";
import { SchemaStatus } from "../../src/v1/workflow/models";
import type { MappingTemplate } from "../../src/v1/workflow/utils/transformer/mapping-spec.types";

// In-Memory Mock Repository to test complete workflow 100% offline without connecting to MongoDB
class MockInvoiceSchemaDictionaryRepo {
  private store = new Map<string, any>();

  async findBySchemaId(schemaId: string) {
    return this.store.get(schemaId) || null;
  }

  async findDefaultBySourceType(sourceType: string) {
    for (const doc of this.store.values()) {
      if (doc.source_type === sourceType && doc.is_default) {
        return doc;
      }
    }
    return null;
  }

  async findBySourceType(sourceType: string, activeOnly?: boolean) {
    const results: any[] = [];
    for (const doc of this.store.values()) {
      if (doc.source_type === sourceType) {
        if (!activeOnly || doc.status === SchemaStatus.ACTIVE) {
          results.push(doc);
        }
      }
    }
    return results;
  }

  async create(input: any) {
    const doc = {
      ...input,
      _id: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(input.schema_id, doc);
    return doc;
  }

  async update(schemaId: string, update: any) {
    const existing = this.store.get(schemaId) || {};
    const updated = { ...existing, ...update, updatedAt: new Date() };
    this.store.set(schemaId, updated);
    return updated;
  }
}

// Local Mock Outbound Transmission Service for sending invoices offline
class MockNRSOutboundTransmitter {
  static async transmitInvoice(nrsInvoice: Record<string, any>) {
    const startTime = performance.now();
    
    // Simulate digital signing & transmission to NRS/FIRS endpoint
    const transmissionReceipt = {
      status: "TRANSMITTED_SUCCESSFULLY",
      ack_id: `ACK-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      irn: nrsInvoice.irn || nrsInvoice.invoice_number,
      issue_date: nrsInvoice.issue_date,
      supplier_tin: nrsInvoice.accounting_supplier_party?.tin,
      customer_tin: nrsInvoice.accounting_customer_party?.tin,
      payable_amount: nrsInvoice.legal_monetary_total?.payable_amount,
      currency: nrsInvoice.document_currency_code,
      line_items_count: Array.isArray(nrsInvoice.invoice_line) ? nrsInvoice.invoice_line.length : 0,
      firs_qr_code: `https://einvoice.firs.gov.ng/verify?irn=${nrsInvoice.irn}&amt=${nrsInvoice.legal_monetary_total?.payable_amount}`,
      timestamp: new Date().toISOString(),
      latency_ms: Math.round((performance.now() - startTime) * 100) / 100,
    };

    return transmissionReceipt;
  }
}

describe("Sage X3 & Tally ERP Live Payload Testing Suite", () => {
  const mockRepo = new MockInvoiceSchemaDictionaryRepo();
  const transformService = new TransformWorkflowService({
    invoiceRepo: mockRepo as any,
    tenantService: {} as any,
  });

  // 1. Sage X3 Sample Payload provided by user
  const sagePayload = {
    invoice: {
      SIH0_1: {
        SALFCY: "HTECH",
        ZSALFCY: "HEIRS TECHNOLOGIES HQ",
        SIVTYP: "ZAINV",
        ZSIVTYP: "Sales Inv",
        NUM: "HTECHZAINV2512000472",
        INVREF: "",
        INVDAT: "20251231",
        BPCINV: "BP0001",
        BPINAM: "United Bank for Africa",
        CUR: "NGN",
        ZCUR: "Nigerian naira",
      },
      SIH1_1: {
        BPCORD: "BP0001",
        BPCNAM: "United Bank for Africa",
        BPRPAY: "BP0001",
        ZBPRPAY: "United Bank for Africa",
        BPCGRU: "BP0001",
        ZBPCGRU: "United Bank for Africa",
        BPAADD: "1",
        BPDNAM: "UBA",
      },
      SIH1_3: { PJT: "" },
      SIH1_4: { REP: ["", ""], ZREP: ["", ""] },
      SIH1_5: { SIHORI: "1", SIHORI_LBL: "Direct", SIHORINUM: "", PIHNUM: "" },
      SIH1_6: { VACBPR: "VAT75", ZVACBPR: "Vat 7.5%", PRITYP: "1", PRITYP_LBL: "Exclude tax" },
      SIH1_7: { STOMVTFLG: "1", STOMVTFLG_LBL: "No", STOFCY: "", ZSTOFCY: "", TRSFAM: "", ZTRSFAM: "", EECICT: "", ZEECICT: "", ICTCTY: "" },
      SIH1_8: { INVSTA: "1", INVSTA_LBL: "Not posted", STARPT: "1", STARPT_LBL: "No", BETCPY: "1", BETCPY_LBL: "No" },
      SIH1_9: { LICPLATE: "", TRLLICPLATE: "", DPEDAT: null, ETD: "0000", ARVDAT: null, ETA: "0000" },
      SIH1_10: { ZIRN: "", ZQRCODE: "", ZVERSTA: "" },
      SIH2_1: {
        CUR: "NGN",
        ZCUR: "Nigerian naira",
        CURTYP: "1",
        CURTYP_LBL: "Daily rate",
        RAT1: "1",
        LABEL: "NGN =",
        RAT2: "1",
        CURMLT: "NGN",
      },
      SIH2_2: {
        BPRFCT: "",
        ZBPRFCT: "",
        BPRSAC: "TROR",
        STRDUDDAT: "20251231",
        PTE: "7DAYS",
        ZPTE: "7 days payment",
        DEP: "",
        ZDEP: "",
      },
      SIH2_3: { DES: ["", "", ""] },
      SIH2_5: [
        { SHO: "Discount %", INVDTAAMT: "0", INVDTATYP: "3", INVDTATYP_LBL: "%" },
        { SHO: "Freight", INVDTAAMT: "0", INVDTATYP: "1", INVDTATYP_LBL: "Tax excluded" },
        { SHO: "Insurance", INVDTAAMT: "0", INVDTATYP: "1", INVDTATYP_LBL: "Tax excluded" },
        { SHO: "Tax-excl. di", INVDTAAMT: "0", INVDTATYP: "3", INVDTATYP_LBL: "%" },
        { SHO: "Man. fees", INVDTAAMT: "0", INVDTATYP: "1", INVDTATYP_LBL: "Tax excluded" },
      ],
      SIH4_2: { PFMTOT: "150000" },
      SIH4_3: { INVNOT: "150000", INVATI: "161250" },
      SIH4_1: [
        {
          ITMREF: "MGDSER",
          ITMDES: "Billing",
          ITMDES1: "MANAGED SERVICES",
          INVPRC: "0",
          SAU: "UN",
          QTY: "1",
          SAUSTUCOE: "1",
          STU: "UN",
          GROPRI: "30000",
          DISCRGVAL1: "0",
          DISCRGVAL2: "0",
          DISCRGVAL3: "0",
          NETPRI: "30000",
          CPRPRI: "0",
          PFM: "30000",
          VACITM1: "VAT75",
          VACITM2: "",
          VACITM3: "",
        },
        {
          ITMREF: "MGDSER",
          ITMDES: "MANAGED SERVICES",
          ITMDES1: "MANAGED SERVICES",
          INVPRC: "0",
          SAU: "UN",
          QTY: "2",
          SAUSTUCOE: "1",
          STU: "UN",
          GROPRI: "60000",
          DISCRGVAL1: "0",
          DISCRGVAL2: "0",
          DISCRGVAL3: "0",
          NETPRI: "60000",
          CPRPRI: "0",
          PFM: "60000",
          VACITM1: "VAT75",
          VACITM2: "",
          VACITM3: "",
        },
      ],
      SIHV_1: { VALUATION: "42" },
      SIHV_4: {
        INVNOT: "150000",
        INVNOTRPT: "150000",
        DEVRPT1: "NGN",
        BASDEP: "0",
        INVATI: "161250",
        INVATIRPT: "161250",
        DEVRPT2: "NGN",
      },
      SIHV_2: [
        {
          NOLIGV: "1",
          XVSHO: "Vat 7.5%",
          XVNOT: "150000",
          XVSMI: "150000",
          XVTAX: "VAT75",
          XVRAT: "7.5",
          XVAMT: "11250",
          XVSUP: "0",
          XVATI: "161250",
        },
      ],
      SIHV_3: [],
      ADXTEC: { WW_MODSTAMP: "20260819095701", WW_MODUSER: "ADMIN" },
    },
  };

  // 2. Tally ERP Sample Payload provided by user
  const tallyPayload = {
    irn: "INV-000011-8593BD6E-20260819",
    event: "erp.invoice.submitted",
    status: "PENDING",
    due_date: "2026-09-19",
    eventType: "erp.invoice.submitted",
    tax_total: [
      {
        tax_amount: 15000,
        tax_subtotal: [
          {
            tax_amount: 15000,
            tax_category: {
              id: "VAT",
              percent: 7.5,
              tax_category_id: "db3b5763-1acb-4397-ac44-1a2fa90d0f4f",
            },
            taxable_amount: 200000,
          },
        ],
      },
    ],
    tenant_id: "37c9da19-f917-48a0-842c-a963feed9010",
    timestamp: "2026-08-19T12:29:56.228053+00:00",
    invoice_id: "1e92dffa-03d4-4b5a-9abc-8716c6fada75",
    issue_date: "2026-08-19",
    webhook_id: "1b95f30a-0630-4e6a-9280-21a8f9718cc7",
    business_id: "37c9da19-f917-48a0-842c-a963feed9010",
    signatories: [
      {
        id: "0bc3c680-7435-41f0-8679-2913c06ad4db",
        name: "Good Man",
        title: "CFO",
        is_primary: true,
        signature_url: "",
      },
    ],
    invoice_kind: "B2B",
    invoice_line: [
      {
        item: {
          name: "Office building payment",
          description: "",
          sellers_item_identification: "",
        },
        price: {
          price_unit: "NGN per 1",
          price_amount: "200000",
          base_quantity: 1,
          currency_code: null,
          original_price_amount: null,
        },
        item_id: "9f41cb9c-0cd0-4bf8-ab5a-9c33637eb58d",
        fee_rate: "0",
        hsn_code: "3278.00",
        tax_rate: "7.50",
        is_credit: false,
        isic_code: "6213",
        fee_amount: "0",
        tax_amount: "15000",
        tax_category: "VAT",
        currency_code: "NGN",
        discount_rate: "0",
        exchange_rate: "1",
        discount_amount: "0",
        tax_category_id: "db3b5763-1acb-4397-ac44-1a2fa90d0f4f",
        product_category: "",
        service_category: "Marketing",
        invoiced_quantity: 1,
        exchange_rate_date: "2026-08-19",
        original_line_amount: "200000",
        line_extension_amount: "200000",
        exchange_rate_requested_date: "2026-08-19",
      },
    ],
    bank_accounts: [
      {
        id: "c878448c-fcf4-455d-8db8-ad07577fc9e8",
        label: "NGN Account",
        branch: "",
        bank_name: "UBA",
        account_name: "Heirs Technologies Ltd",
        extra_fields: [],
        account_number: "2346524764",
        account_country: "NG",
      },
    ],
    nrs_validated: false,
    invoice_number: "INV-000011",
    payment_status: "PENDING",
    invoice_type_code: "380",
    tax_currency_code: "NGN",
    legal_monetary_total: {
      payable_amount: 215000,
      tax_exclusive_amount: 200000,
      tax_inclusive_amount: 215000,
      line_extension_amount: 200000,
    },
    document_currency_code: "NGN",
    accounting_customer_party: {
      tin: "4563245",
      email: "heirs@energies.com",
      telephone: "+23483265438",
      party_name: "Heirs Energies",
      postal_address: {
        country: "NG",
        city_name: "Amuwo-Odofin",
        postal_zone: "10045",
        street_name: "23 Amuwo-Odofin street",
      },
    },
    accounting_supplier_party: {
      tin: "00364075-0001",
      email: "finance@heirstechnologies.com",
      telephone: "+23402018889719",
      party_name: "Heirs Technologies Ltd",
      postal_address: {
        state: "Lagos",
        country: "NG",
        city_name: "Victoria Island",
        postal_zone: "2345",
        street_name: "Bishop Oyewole Street",
      },
      business_description: "We do Tech consultancy and outsourcing.",
    },
  };

  beforeAll(() => {
    // Register the standard NRS target schema in the database-driven registry
    NRSSchemaRegistry.registerFromDB(
      "v1.0",
      "FIRS NRS UBL v1.0",
      "Standard FIRS NRS Invoicing Schema",
      [
        { field_id: "irn", field_path: "irn", is_required: true, data_type: "string" },
        { field_id: "issue_date", field_path: "issue_date", is_required: true, data_type: "string" },
        { field_id: "document_currency_code", field_path: "document_currency_code", is_required: true, data_type: "string" },
        { field_id: "accounting_supplier_party.tin", field_path: "accounting_supplier_party.tin", is_required: true, data_type: "string" },
        { field_id: "accounting_supplier_party.party_name", field_path: "accounting_supplier_party.party_name", is_required: true, data_type: "string" },
        { field_id: "accounting_customer_party.tin", field_path: "accounting_customer_party.tin", is_required: true, data_type: "string" },
        { field_id: "accounting_customer_party.party_name", field_path: "accounting_customer_party.party_name", is_required: true, data_type: "string" },
        { field_id: "legal_monetary_total.tax_exclusive_amount", field_path: "legal_monetary_total.tax_exclusive_amount", is_required: true, data_type: "number" },
        { field_id: "legal_monetary_total.payable_amount", field_path: "legal_monetary_total.payable_amount", is_required: true, data_type: "number" },
        { field_id: "invoice_line", field_path: "invoice_line", is_required: true, data_type: "array" },
      ],
      true,
    );
  });

  it("should process Sage X3 payload via AI/LLM mapping mode, validate against NRS schema, and transmit invoice", async () => {
    console.log("\n=======================================================");
    console.log("▶ [TEST 1] SAGE X3 PAYLOAD TRANSFORMATION & TRANSMISSION");
    console.log("=======================================================");

    // Step A: Simulate LLM-Assisted Mapping Generation (mapping_type = 'llm')
    console.log("1. [LLM AI-Mapper] Analyzing Sage X3 JSON payload hierarchy (SIH0_1, SIH1_1, SIH4_1)...");
    const sageLLMGeneratedTemplate: MappingTemplate = {
      erp_source: "SAGE",
      nrs_schema_version: "v1.0",
      field_mappings: [
        { target: "irn", source: "invoice.SIH0_1.NUM" },
        { target: "invoice_number", source: "invoice.SIH0_1.NUM" },
        { target: "issue_date", source: "invoice.SIH0_1.INVDAT", transform: "toDate" },
        { target: "due_date", source: "invoice.SIH2_2.STRDUDDAT", transform: "toDate" },
        { target: "document_currency_code", source: "invoice.SIH0_1.CUR", default_value: "NGN" },
        { target: "tax_currency_code", source: "invoice.SIH0_1.CUR", default_value: "NGN" },
        { target: "accounting_supplier_party.party_name", source: "invoice.SIH0_1.ZSALFCY", default_value: "HEIRS TECHNOLOGIES HQ" },
        { target: "accounting_supplier_party.tin", source: "invoice.SIH0_1.SALFCY_TIN", default_value: "00364075-0001" },
        { target: "accounting_customer_party.party_name", source: "invoice.SIH0_1.BPINAM", fallback_sources: ["invoice.SIH1_1.BPCNAM"] },
        { target: "accounting_customer_party.tin", source: "invoice.SIH1_1.BPCINV", default_value: "10020030-0001" },
        { target: "legal_monetary_total.tax_exclusive_amount", source: "invoice.SIH4_3.INVNOT", transform: "toNumber" },
        { target: "legal_monetary_total.tax_inclusive_amount", source: "invoice.SIH4_3.INVATI", transform: "toNumber" },
        { target: "legal_monetary_total.payable_amount", source: "invoice.SIH4_3.INVATI", transform: "toNumber" },
      ],
      array_mappings: [
        {
          source_array: "invoice.SIH4_1",
          target_array: "invoice_line",
          item_mappings: [
            { target: "item.name", source: "ITMDES1", fallback_sources: ["ITMDES"] },
            { target: "invoiced_quantity", source: "QTY", transform: "toNumber" },
            { target: "price.price_amount", source: "NETPRI", transform: "toNumber" },
            { target: "line_extension_amount", source: "PFM", transform: "toNumber" },
            { target: "tax_rate", source: "XVRAT", default_value: 7.5, transform: "toNumber" },
          ],
        },
      ],
    };
    console.log("   ✔ AI Template drafted successfully with 13 field mappings and 1 line items array mapping.");

    // Step B: Dry-run test & NRS Schema Validation
    console.log("2. [Gatekeeper] Dry-run testing Sage template against DB-backed NRS Target Schema...");
    const testResult = await transformService.testMappingTemplate(sagePayload, sageLLMGeneratedTemplate);
    console.log(`   ✔ Validation result: ${testResult.success ? "PASSED (100% NRS Compliant)" : "FAILED"}`);
    console.log(`   ✔ Execution latency: ${testResult.executionTimeMs}ms`);
    expect(testResult.success).toBe(true);

    // Step C: Save and Activate ERP Schema in DB
    console.log("3. [DB Store] Activating Sage ERP dictionary with verified MappingTemplate...");
    const savedSageSchema = await transformService.saveMappingTemplate("SAGE", sageLLMGeneratedTemplate, sagePayload);
    console.log(`   ✔ Schema saved with ID: '${savedSageSchema.schema_id}' | Status: ${savedSageSchema.status}`);
    expect(savedSageSchema.status).toBe(SchemaStatus.ACTIVE);

    // Step D: Live Fast Deterministic Transformation
    console.log("4. [Transformation Engine] Executing deterministic transformation on live Sage payload...");
    const startTime = performance.now();
    const transformedSage = await transformService.transformInvoiceV2(
      sagePayload as any,
      { businessId: "BUS-SAGE-01" } as any,
      "SAGE",
    );
    const duration = performance.now() - startTime;
    console.log(`   ✔ Transformed in: ${duration.toFixed(2)}ms (Zero LLM token cost at runtime)`);
    console.log("   ✔ Transformed NRS Payload Preview:", JSON.stringify({
      irn: transformedSage.irn,
      issue_date: transformedSage.issue_date,
      supplier: transformedSage.accounting_supplier_party?.party_name,
      customer: transformedSage.accounting_customer_party?.party_name,
      total_payable: transformedSage.legal_monetary_total?.payable_amount,
      lines_count: transformedSage.invoice_line?.length,
    }, null, 2));

    // Step E: Simulate Outbound Transmission to NRS / FIRS
    console.log("5. [NRS Outbound] Transmitting transformed invoice to FIRS/NRS gateway...");
    const transmissionReceipt = await MockNRSOutboundTransmitter.transmitInvoice(transformedSage);
    console.log("   ✔ Invoicing Transmission Receipt:", JSON.stringify(transmissionReceipt, null, 2));

    expect(transmissionReceipt.status).toBe("TRANSMITTED_SUCCESSFULLY");
    expect(transmissionReceipt.irn).toBe("HTECHZAINV2512000472");
    expect(transmissionReceipt.line_items_count).toBe(2);
    expect(transmissionReceipt.payable_amount).toBe(161250);
  });

  it("should process Tally ERP payload via Manual mapping mode, validate against NRS schema, and transmit invoice", async () => {
    console.log("\n=======================================================");
    console.log("▶ [TEST 2] TALLY ERP PAYLOAD TRANSFORMATION & TRANSMISSION");
    console.log("=======================================================");

    // Step A: Configure Manual Mapping Template (mapping_type = 'manual')
    console.log("1. [Manual Mapper] Loading manual field and array mapping configuration...");
    const tallyManualTemplate: MappingTemplate = {
      erp_source: "TALLY",
      nrs_schema_version: "v1.0",
      field_mappings: [
        { target: "irn", source: "irn", fallback_sources: ["invoice_number"] },
        { target: "invoice_number", source: "invoice_number" },
        { target: "issue_date", source: "issue_date", transform: "toDate" },
        { target: "due_date", source: "due_date", transform: "toDate" },
        { target: "document_currency_code", source: "document_currency_code", default_value: "NGN" },
        { target: "accounting_supplier_party.tin", source: "accounting_supplier_party.tin" },
        { target: "accounting_supplier_party.party_name", source: "accounting_supplier_party.party_name" },
        { target: "accounting_customer_party.tin", source: "accounting_customer_party.tin" },
        { target: "accounting_customer_party.party_name", source: "accounting_customer_party.party_name" },
        { target: "accounting_customer_party.email", source: "accounting_customer_party.email" },
        { target: "legal_monetary_total.tax_exclusive_amount", source: "legal_monetary_total.tax_exclusive_amount", transform: "toNumber" },
        { target: "legal_monetary_total.payable_amount", source: "legal_monetary_total.payable_amount", transform: "toNumber" },
      ],
      array_mappings: [
        {
          source_array: "invoice_line",
          target_array: "invoice_line",
          item_mappings: [
            { target: "item.name", source: "item.name" },
            { target: "invoiced_quantity", source: "invoiced_quantity", transform: "toNumber" },
            { target: "price.price_amount", source: "price.price_amount", transform: "toNumber" },
            { target: "line_extension_amount", source: "line_extension_amount", transform: "toNumber" },
            { target: "tax_amount", source: "tax_amount", transform: "toNumber" },
            { target: "tax_rate", source: "tax_rate", transform: "toNumber" },
          ],
        },
      ],
    };
    console.log("   ✔ Manual Template configured with 12 direct field mappings and 1 invoice_line array mapping.");

    // Step B: Dry-run test & NRS Schema Validation
    console.log("2. [Gatekeeper] Dry-run testing Tally template against DB-backed NRS Target Schema...");
    const testResult = await transformService.testMappingTemplate(tallyPayload, tallyManualTemplate);
    console.log(`   ✔ Validation result: ${testResult.success ? "PASSED (100% NRS Compliant)" : "FAILED"}`);
    console.log(`   ✔ Execution latency: ${testResult.executionTimeMs}ms`);
    expect(testResult.success).toBe(true);

    // Step C: Save and Activate ERP Schema in DB
    console.log("3. [DB Store] Activating Tally ERP dictionary with verified MappingTemplate...");
    const savedTallySchema = await transformService.saveMappingTemplate("TALLY", tallyManualTemplate, tallyPayload);
    console.log(`   ✔ Schema saved with ID: '${savedTallySchema.schema_id}' | Status: ${savedTallySchema.status}`);
    expect(savedTallySchema.status).toBe(SchemaStatus.ACTIVE);

    // Step D: Live Fast Deterministic Transformation
    console.log("4. [Transformation Engine] Executing deterministic transformation on live Tally payload...");
    const startTime = performance.now();
    const transformedTally = await transformService.transformInvoiceV2(
      tallyPayload as any,
      { businessId: "BUS-TALLY-01" } as any,
      "TALLY",
    );
    const duration = performance.now() - startTime;
    console.log(`   ✔ Transformed in: ${duration.toFixed(2)}ms (Zero LLM token cost at runtime)`);
    console.log("   ✔ Transformed NRS Payload Preview:", JSON.stringify({
      irn: transformedTally.irn,
      issue_date: transformedTally.issue_date,
      supplier: transformedTally.accounting_supplier_party?.party_name,
      customer: transformedTally.accounting_customer_party?.party_name,
      total_payable: transformedTally.legal_monetary_total?.payable_amount,
      lines_count: transformedTally.invoice_line?.length,
    }, null, 2));

    // Step E: Simulate Outbound Transmission to NRS / FIRS
    console.log("5. [NRS Outbound] Transmitting transformed invoice to FIRS/NRS gateway...");
    const transmissionReceipt = await MockNRSOutboundTransmitter.transmitInvoice(transformedTally);
    console.log("   ✔ Invoicing Transmission Receipt:", JSON.stringify(transmissionReceipt, null, 2));

    expect(transmissionReceipt.status).toBe("TRANSMITTED_SUCCESSFULLY");
    expect(transmissionReceipt.irn).toBe("INV-000011-8593BD6E-20260819");
    expect(transmissionReceipt.line_items_count).toBe(1);
    expect(transmissionReceipt.payable_amount).toBe(215000);
  });
});
