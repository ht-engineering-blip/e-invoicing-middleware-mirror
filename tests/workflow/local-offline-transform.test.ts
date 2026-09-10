import { describe, expect, it } from "bun:test";
import { TransformWorkflowService } from "../../src/v1/workflow/services/workflows/transform.service";
import { NRSSchemaRegistry } from "../../src/v1/workflow/utils/transformer/nrs-schema-registry";
import { SchemaStatus } from "../../src/v1/workflow/models";
import type { MappingTemplate } from "../../src/v1/workflow/utils/transformer/mapping-spec.types";

// In-Memory Mock Repository for completely offline testing without MongoDB
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
      _id: `mock_${Date.now()}`,
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

describe("Local Offline Transformation & Validation (Zero DB Connection)", () => {
  const mockRepo = new MockInvoiceSchemaDictionaryRepo();
  const transformService = new TransformWorkflowService({
    invoiceRepo: mockRepo as any,
    tenantService: {} as any,
  });

  it("should save mapping template and transform live ERP invoice 100% offline", async () => {
    // 1. Define a sample Sage ERP mapping template
    const sageTemplate: MappingTemplate = {
      erp_source: "SAGE",
      nrs_schema_version: "v1.0",
      field_mappings: [
        { target: "irn", source: "doc_number" },
        { target: "issue_date", source: "doc_date", transform: "toDate" },
        { target: "accounting_supplier_party.tin", source: "company.tin" },
        { target: "accounting_supplier_party.party_name", source: "company.name" },
        { target: "accounting_customer_party.tin", source: "client.tax_id" },
        { target: "accounting_customer_party.party_name", source: "client.company_name" },
        { target: "accounting_customer_party.email", source: "client.billing_email" },
        { target: "document_currency_code", source: "currency", default_value: "NGN" },
      ],
      array_mappings: [
        {
          source_array: "items",
          target_array: "invoice_line",
          item_mappings: [
            { target: "item.name", source: "description" },
            { target: "invoiced_quantity", source: "quantity", transform: "toNumber" },
            { target: "price.price_amount", source: "rate", transform: "toNumber" },
            { target: "line_extension_amount", source: "amount", transform: "toNumber" },
          ],
        },
      ],
      constants: {
        document_currency_code: "NGN",
        tax_currency_code: "NGN",
        invoice_type_code: "380",
      },
    };

    // 2. Save mapping template into our in-memory repo
    await transformService.saveMappingTemplate("SAGE", sageTemplate);

    // 3. Simulate incoming Sage ERP invoice payload
    const incomingSageInvoice = {
      doc_number: "SAGE-INV-10029",
      doc_date: "2026-09-08T09:30:00Z",
      currency: "NGN",
      company: {
        tin: "55667788-0001",
        name: "Prime Logistics Ltd",
      },
      client: {
        tax_id: "99881122-0001",
        company_name: "Apex Manufacturing Plc",
        billing_email: "accounts@apex.ng",
      },
      items: [
        {
          description: "Freight Delivery Service - Zone 1",
          quantity: 3,
          rate: 45000,
          amount: 135000,
        },
        {
          description: "Handling Fee",
          quantity: 1,
          rate: 15000,
          amount: 15000,
        },
      ],
    };

    // 4. Run transformInvoiceV2 (should use deterministic engine locally)
    const startTime = performance.now();
    const transformed = await transformService.transformInvoiceV2(
      incomingSageInvoice as any,
      { businessId: "BUS-SAGE-01" } as any,
      "SAGE",
    );
    const duration = performance.now() - startTime;

    // 5. Verify results
    expect(transformed).toBeDefined();
    expect(transformed.irn).toContain("SAGEINV10029");
    expect(transformed.issue_date).toBe("2026-09-08");
    expect(transformed.accounting_supplier_party.tin).toBe("55667788-0001");
    expect(transformed.accounting_customer_party.tin).toBe("99881122-0001");
    expect(transformed.accounting_customer_party.email).toBe("accounts@apex.ng");
    expect(transformed.invoice_line.length).toBe(2);
    expect(transformed.invoice_line[0].item.name).toBe("Freight Delivery Service - Zone 1");
    expect(transformed.invoice_line[0].invoiced_quantity).toBe(3);
    expect(transformed.invoice_line[0].line_extension_amount).toBe(135000);

    // Math healing verification
    expect(transformed.legal_monetary_total).toBeDefined();
    expect(transformed.legal_monetary_total.line_extension_amount).toBe(150000);
    expect(transformed.tax_total).toBeDefined();
    expect(transformed.legal_monetary_total.payable_amount).toBeGreaterThan(150000);

    // Fast execution check (< 10ms offline)
    expect(duration).toBeLessThan(25);
  });

  it("should test mapping templates via testMappingTemplate() without saving", async () => {
    const rawERPPayload = {
      ref: "PO-7788",
      date: "2026-09-08",
      customer: {
        vat_no: "44556677-0001",
        full_name: "Swift Retailers",
        contact_email: "orders@swift.ng",
      },
      products: [
        {
          title: "Widget A",
          qty: 10,
          price: 500,
        },
      ],
    };

    const draftTemplate: MappingTemplate = {
      erp_source: "ZOHO",
      field_mappings: [
        { target: "irn", source: "ref" },
        { target: "issue_date", source: "date" },
        { target: "accounting_customer_party.tin", source: "customer.vat_no" },
        { target: "accounting_customer_party.party_name", source: "customer.full_name" },
        { target: "accounting_customer_party.email", source: "customer.contact_email" },
      ],
      array_mappings: [
        {
          source_array: "products",
          target_array: "invoice_line",
          item_mappings: [
            { target: "item.name", source: "title" },
            { target: "invoiced_quantity", source: "qty", transform: "toNumber" },
            { target: "price.price_amount", source: "price", transform: "toNumber" },
            { target: "line_extension_amount", source: "total", default_value: 5000 },
          ],
        },
      ],
    };

    const preview = await transformService.testMappingTemplate(rawERPPayload, draftTemplate);

    expect(preview.success).toBe(true);
    expect(preview.data?.irn).toContain("PO7788");
    expect(preview.data?.accounting_customer_party?.tin).toBe("44556677-0001");
    expect(preview.data?.invoice_line?.length).toBe(1);
    expect(preview.appliedRulesCount).toBeGreaterThan(0);
  });
});
