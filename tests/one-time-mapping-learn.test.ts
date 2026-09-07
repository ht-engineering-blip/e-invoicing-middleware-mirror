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

    // Absolutely 0 LLM calls for all 1,000 invoices
    expect(llmCallCount).toBe(0);
  });
});
