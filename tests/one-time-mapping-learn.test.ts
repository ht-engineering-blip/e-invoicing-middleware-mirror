import { describe, expect, it } from "bun:test";
import { FIRSInvoiceTransformerV2 } from "../src/v1/workflow/utils/transformer/v2";
import { TransformWorkflowService } from "../src/v1/workflow/services/workflows/transform.service";
import { LLMService } from "../src/@lib/adapters/llm/llm.service";
import { FIRSService } from "../src/@lib/adapters/firs/firs.service";
import { FIRSInvoiceSchema } from "../src/v1/workflow/utils/transformer";
import { ISchemaField, SchemaSourceType, SchemaStatus } from "../src/v1/workflow/models";
import { AuthContext } from "../src/middlewares";

// Mock FIRSService.getResource to return immediate local data without network delay
FIRSService.prototype.getResource = async function (endpoint: string): Promise<any[]> {
  if (endpoint === "tax-categories") return [{ id: "STANDARD_VAT", percent: 7.5 }];
  if (endpoint === "invoice-types") return [{ code: "396", name: "Tax Invoice" }];
  if (endpoint === "currencies") return [{ code: "NGN", name: "Nigerian Naira" }];
  return [];
};

// Bypass MongoDB connection in unit test
TransformWorkflowService.prototype.getInvoiceSchema = async function () {
  return null;
};

describe("One-Time LLM Mapping Learning & Zero-Cost Deterministic Execution", () => {
  const sampleERPPayload = {
    bill_number: "SAP-INV-2026-999",
    billing_date: "2026-09-07",
    payment_due: "2026-10-07",
    currency: "NGN",
    client_name: "Dangote Cement Plc",
    client_tin: "10293847-0001",
    subtotal_amount: 500000,
    vat_amount: 37500,
    total_payable: 537500,
    items: [
      {
        material_name: "Industrial Portland Cement 50kg",
        qty: 100,
        rate: 5000,
        amount: 500000,
      },
    ],
  };

  const learnedMappingRules = [
    { source: "bill_number", target: "id" },
    { source: "billing_date", target: "issue_date" },
    { source: "payment_due", target: "due_date" },
    { source: "currency", target: "document_currency_code" },
    { source: "client_name", target: "accounting_customer_party.party_name" },
    { source: "client_tin", target: "accounting_customer_party.party_tax_scheme.company_id" },
    { source: "subtotal_amount", target: "legal_monetary_total.line_extension_amount" },
    { source: "vat_amount", target: "tax_total[0].tax_amount" },
    { source: "total_payable", target: "legal_monetary_total.payable_amount" },
    { source: "items[*].material_name", target: "invoice_line[*].item.name" },
    { source: "items[*].qty", target: "invoice_line[*].invoiced_quantity" },
    { source: "items[*].rate", target: "invoice_line[*].price.price_amount" },
    { source: "items[*].amount", target: "invoice_line[*].line_extension_amount" },
  ];

  const authContext: AuthContext = {
    tenantId: "tenant_heirs_oil_001",
    businessName: "Heirs Energies Limited",
    tin: "99887766-0001",
    tenantERP: "SAP",
  } as any;

  it("should learn mapping rules once via LLM and persist them", async () => {
    let llmCallCount = 0;

    // Spy / mock LLMService.prototype.generateMappingRules
    const originalGenerate = LLMService.prototype.generateMappingRules;
    LLMService.prototype.generateMappingRules = async function () {
      llmCallCount++;
      return learnedMappingRules;
    };

    let savedSchemaDoc: any = null;
    const transformService = new TransformWorkflowService();

    // Mock upsertERPSchema and getInvoiceSchema
    transformService.upsertERPSchema = async function (erp, fields, opts) {
      savedSchemaDoc = {
        schema_id: `${erp}_INVOICE_SCHEMA`,
        source_type: erp,
        fields,
        mapping_rules: opts?.mapping_rules || [],
        status: SchemaStatus.ACTIVE,
      };
      return savedSchemaDoc;
    };

    transformService.getInvoiceSchema = async function (sourceType) {
      if (sourceType === SchemaSourceType.FIRS_UBL) {
        return {
          schema_id: "FIRS_UBL_INVOICE_SCHEMA",
          fields: [
            { field_path: "id", is_required: true, data_type: "String" },
            { field_path: "issue_date", is_required: true, data_type: "Date" },
          ],
        } as any;
      }
      return savedSchemaDoc;
    };

    // 1. First time: synthesize and persist mapping rules
    const rules = await transformService.learnAndPersistMappingRules("SAP", sampleERPPayload);

    expect(llmCallCount).toBe(1);
    expect(rules.length).toBe(learnedMappingRules.length);
    expect(savedSchemaDoc).toBeDefined();
    expect(savedSchemaDoc.mapping_rules.length).toBe(learnedMappingRules.length);

    // Restore
    LLMService.prototype.generateMappingRules = originalGenerate;
  });

  it("should transform subsequent invoices with exactly 0 LLM calls using persisted mapping rules", async () => {
    let llmCallCount = 0;
    const transformer = new FIRSInvoiceTransformerV2("fake_key");

    // Intercept any LLM calls on transformer
    (transformer as any).callLLM = async function () {
      llmCallCount++;
      throw new Error("Unexpected LLM call during deterministic fast path!");
    };

    const firsSchema: ISchemaField[] = [
      { field_path: "id", is_required: true, data_type: "String" } as any,
      { field_path: "issue_date", is_required: true, data_type: "Date" } as any,
      { field_path: "accounting_customer_party.party_name", is_required: true, data_type: "String" } as any,
      { field_path: "legal_monetary_total.payable_amount", is_required: true, data_type: "Number" } as any,
      { field_path: "invoice_line", is_required: true, data_type: "Array" } as any,
    ];

    // Run 100 iterations to verify deterministic scaling
    for (let i = 0; i < 100; i++) {
      const invoiceData = {
        ...sampleERPPayload,
        bill_number: `SAP-INV-2026-${1000 + i}`,
      };

      const result = await transformer.transformInvoice(
        invoiceData,
        authContext,
        [],
        firsSchema,
        learnedMappingRules,
        FIRSInvoiceSchema,
      );

      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as any;
        expect(data.id).toBe(`SAP-INV-2026-${1000 + i}`);
        expect(data.accounting_customer_party.party_name).toBe("Dangote Cement Plc");
        expect(data.legal_monetary_total.payable_amount).toBe(537500);
        expect(data.invoice_line.length).toBe(1);
        expect(data.invoice_line[0].item.name).toBe("Industrial Portland Cement 50kg");
      }
    }

    // Absolutely 0 LLM calls for all 100 invoices
    expect(llmCallCount).toBe(0);
  });

  it("should correctly unwrap envelope payload (data wrapper) and preserve all non-zero amounts", async () => {
    const transformer = new FIRSInvoiceTransformerV2("fake_key");

    const tallyEnvelopePayload = {
      data: {
        business_id: "63e829e4-0e80-42c1-8c08-29dab44b51a0",
        irn: "882/D-701/254CN-TS-45678901-20260907",
        issue_date: "2026-09-07",
        invoice_type_code: "380",
        invoice_kind: "B2B",
        payment_status: "PENDING",
        document_currency_code: "NGN",
        accounting_supplier_party: {
          tin: "TIN-9876543210",
          email: "send.info@okeketech.com",
          telephone: "+2348012345678",
          party_name: "Heirs Technologies Limited",
          postal_address: {
            state: "Lagos",
            country: "NG",
            city_name: "Lagos",
            postal_zone: "1234567",
            street_name: "123 Business Street",
          },
          business_description: "Venture into wood making",
        },
        accounting_customer_party: {
          tin: "00364075-0002",
          email: "victor.adeife@heirstechnologies.com",
          telephone: "+2347033123358",
          party_name: "Heirs Technologies",
          postal_address: {
            country: "NG",
            city_name: "Abuja",
            postal_zone: "100011",
            street_name: "ChurchGate Towers, CBD, Abuja.",
          },
          business_description: "Tech firm",
        },
        legal_monetary_total: {
          line_extension_amount: 13554,
          tax_exclusive_amount: 13554,
          tax_inclusive_amount: 14379.2,
          payable_amount: 14379.2,
        },
        invoice_line: [
          {
            item: {
              name: "Premium Coffee Beans",
              description: "",
              sellers_item_identification: null,
            },
            price: {
              price_unit: "NGN per 1",
              price_amount: "5900",
              base_quantity: 1,
            },
            invoiced_quantity: 1,
            line_extension_amount: "5900",
          },
          {
            item: {
              name: "Test Invoice template Standard",
              description: "Tesssssting",
              sellers_item_identification: null,
            },
            price: {
              price_unit: "NGN per 1",
              price_amount: "7654",
              base_quantity: 1,
            },
            invoiced_quantity: 1,
            line_extension_amount: "7654",
          },
        ],
      },
    };

    const result = await transformer.transformInvoice(
      tallyEnvelopePayload,
      authContext,
      [],
      [],
      [],
      FIRSInvoiceSchema,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as any;
      expect(data.accounting_customer_party.party_name).toBe("Heirs Technologies");
      expect(data.legal_monetary_total.line_extension_amount).toBe(13554);
      expect(data.legal_monetary_total.tax_exclusive_amount).toBe(13554);
      expect(data.legal_monetary_total.tax_inclusive_amount).toBe(14379.2);
      expect(data.legal_monetary_total.payable_amount).toBe(14379.2);
      expect(data.invoice_line.length).toBe(2);
      expect(data.invoice_line[0].item.name).toBe("Premium Coffee Beans");
      expect(data.invoice_line[0].price.price_amount).toBe(5900);
      expect(data.invoice_line[0].line_extension_amount).toBe(5900);
      expect(data.invoice_line[1].item.name).toBe("Test Invoice template Standard");
      expect(data.invoice_line[1].price.price_amount).toBe(7654);
      expect(data.invoice_line[1].line_extension_amount).toBe(7654);
    }
  });
});
