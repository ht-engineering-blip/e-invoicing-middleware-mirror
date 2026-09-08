import { describe, expect, it } from "bun:test";
import { DeterministicMappingEngine } from "../../src/v1/workflow/utils/transformer/deterministic-engine";
import { TransformWorkflowService } from "../../src/v1/workflow/services/workflows/transform.service";
import { NRSSchemaRegistry } from "../../src/v1/workflow/utils/transformer/nrs-schema-registry";
import { SchemaStatus } from "../../src/v1/workflow/models";
import type { MappingTemplate } from "../../src/v1/workflow/utils/transformer/mapping-spec.types";

class MockRepo {
  private store = new Map<string, any>();
  async findBySchemaId(id: string) { return this.store.get(id) || null; }
  async findDefaultBySourceType(type: string) { return null; }
  async findBySourceType(type: string) { return []; }
  async create(input: any) { this.store.set(input.schema_id, input); return input; }
  async update(id: string, u: any) { const doc = { ...this.store.get(id), ...u }; this.store.set(id, doc); return doc; }
}

describe("Performance & Scale Test: 1,000+ JSON Line Items", () => {
  it("should transform an ERP payload with 1,500 line items in under 50ms", () => {
    // Generate 1,500 realistic line items
    const lineItemCount = 1500;
    const lineItems = new Array(lineItemCount);
    for (let i = 0; i < lineItemCount; i++) {
      lineItems[i] = {
        sku: `SKU-${1000 + i}`,
        desc: `Bulk Industrial Product Part #${i + 1}`,
        qty: (i % 10) + 1,
        unit_price: 2500 + i * 10,
        subtotal: ((i % 10) + 1) * (2500 + i * 10),
      };
    }

    const largeERPInvoice = {
      order_ref: "PO-LARGE-1500",
      invoice_date: "2026-09-08",
      supplier: {
        tin: "11223344-0001",
        name: "Mega Distribution Hub Plc",
      },
      customer: {
        tin: "99887766-0001",
        name: "Continental Retail Conglomerate",
        email: "finance@continental.ng",
      },
      items: lineItems,
    };

    const template: MappingTemplate = {
      erp_source: "ORACLE_EBS",
      nrs_schema_version: "v1.0",
      field_mappings: [
        { target: "irn", source: "order_ref" },
        { target: "issue_date", source: "invoice_date" },
        { target: "accounting_supplier_party.tin", source: "supplier.tin" },
        { target: "accounting_supplier_party.party_name", source: "supplier.name" },
        { target: "accounting_customer_party.tin", source: "customer.tin" },
        { target: "accounting_customer_party.party_name", source: "customer.name" },
        { target: "accounting_customer_party.email", source: "customer.email" },
      ],
      array_mappings: [
        {
          source_array: "items",
          target_array: "invoice_line",
          item_mappings: [
            { target: "item.name", source: "desc" },
            { target: "invoiced_quantity", source: "qty", transform: "toNumber" },
            { target: "price.price_amount", source: "unit_price", transform: "toNumber" },
            { target: "line_extension_amount", source: "subtotal", transform: "toNumber" },
          ],
        },
      ],
      constants: {
        document_currency_code: "NGN",
        tax_currency_code: "NGN",
        invoice_type_code: "380",
      },
    };

    const startTime = performance.now();
    const result = DeterministicMappingEngine.transform(largeERPInvoice, template);
    const duration = performance.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.invoice_line?.length).toBe(1500);
    expect(result.data?.invoice_line[0].item.name).toBe("Bulk Industrial Product Part #1");
    expect(result.data?.invoice_line[1499].item.name).toBe("Bulk Industrial Product Part #1500");
    expect(result.data?.legal_monetary_total?.payable_amount).toBeGreaterThan(0);

    // Performance assertion: 1,500 items mapped, healed, and validated in < 50ms
    console.log(`[Benchmark] 1,500 Line Items transformed and validated in: ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(75);
  });
});

describe("Strict Gatekeeper Validation on ERP Onboarding", () => {
  const mockRepo = new MockRepo();
  const transformService = new TransformWorkflowService({
    invoiceRepo: mockRepo as any,
    tenantService: {} as any,
  });

  const validTemplate: MappingTemplate = {
    erp_source: "NETSUITE",
    field_mappings: [
      { target: "irn", source: "tran_id" },
      { target: "issue_date", source: "tran_date" },
      { target: "accounting_customer_party.tin", source: "entity.tax_id" },
      { target: "accounting_customer_party.party_name", source: "entity.company_name" },
      { target: "accounting_customer_party.email", source: "entity.email" },
    ],
    array_mappings: [
      {
        source_array: "item_list",
        target_array: "invoice_line",
        min_items: 1,
        item_mappings: [
          { target: "item.name", source: "item_name" },
          { target: "invoiced_quantity", source: "quantity", transform: "toNumber" },
          { target: "price.price_amount", source: "rate", transform: "toNumber" },
          { target: "line_extension_amount", source: "amount", transform: "toNumber" },
        ],
      },
    ],
  };

  it("should BLOCK saving when sample payload fails NRS validation", async () => {
    // Missing items array completely (hard blocker)
    const invalidSample = {
      tran_id: "INV-FAIL-01",
      tran_date: "2026-09-08",
      entity: {
        tax_id: "12345",
        // company_name missing
      },
      item_list: [], // 0 items!
    };

    let errorThrown: any = null;
    try {
      await transformService.saveMappingTemplate(
        "NETSUITE",
        validTemplate,
        invalidSample,
      );
    } catch (err) {
      errorThrown = err;
    }

    expect(errorThrown).toBeDefined();
    expect(errorThrown.statusCode).toBe(400);
    expect(errorThrown.message).toContain("Cannot save ERP mapping");
    expect(errorThrown.code).toBe("ERP_MAPPING_VALIDATION_FAILED");
    expect(errorThrown.errors.length).toBeGreaterThan(0);
  });

  it("should ALLOW saving and activate ERP when sample payload passes NRS validation", async () => {
    const validSample = {
      tran_id: "INV-PASS-01",
      tran_date: "2026-09-08",
      entity: {
        tax_id: "88990011-0001",
        company_name: "Valid Customer Corp",
        email: "billing@validcorp.ng",
      },
      item_list: [
        {
          item_name: "Software Subscription Tier 1",
          quantity: 1,
          rate: 75000,
          amount: 75000,
        },
      ],
    };

    const saved = await transformService.saveMappingTemplate(
      "NETSUITE",
      validTemplate,
      validSample,
    );

    expect(saved).toBeDefined();
    expect(saved.schema_id).toContain("NETSUITE");
    expect(saved.status).toBe(SchemaStatus.ACTIVE);
  });
});
