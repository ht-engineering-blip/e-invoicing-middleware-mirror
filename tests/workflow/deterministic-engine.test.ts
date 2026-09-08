import { describe, expect, it, beforeEach } from "bun:test";
import { DeterministicMappingEngine } from "../../src/v1/workflow/utils/transformer/deterministic-engine";
import { NRSSchemaRegistry } from "../../src/v1/workflow/utils/transformer/nrs-schema-registry";
import type { MappingTemplate } from "../../src/v1/workflow/utils/transformer/mapping-spec.types";

describe("DeterministicMappingEngine", () => {
  beforeEach(() => {
    NRSSchemaRegistry.clear();
  });
  it("should transform complete ERP payload into compliant NRS invoice deterministically", () => {
    const sampleERPInvoice = {
      order_id: "ORD-99881",
      created_date: "2026-09-08T10:15:30Z",
      buyer: {
        tin_number: "22334455-0001",
        name: "Acme Enterprises NG",
        email: "finance@acme.ng",
        phone: "08012345678",
        city: "Lagos",
      },
      seller: {
        tin: "11223344-0001",
        name: "Test Merchant Ltd",
      },
      line_items: [
        {
          item_title: "Cloud Server Hosting",
          quantity: 2,
          unit_cost: 150000,
          total: 300000,
        },
      ],
    };

    const template: MappingTemplate = {
      erp_source: "CUSTOM_ERP",
      nrs_schema_version: "v1.0",
      field_mappings: [
        { target: "irn", source: "order_id" },
        { target: "issue_date", source: "created_date", transform: "toDate" },
        { target: "accounting_customer_party.tin", source: "buyer.tin_number" },
        { target: "accounting_customer_party.party_name", source: "buyer.name" },
        { target: "accounting_customer_party.email", source: "buyer.email" },
        {
          target: "accounting_customer_party.telephone",
          source: "buyer.phone",
          transform: "sanitizePhone",
        },
        {
          target: "accounting_customer_party.postal_address.city_name",
          source: "buyer.city",
        },
        { target: "accounting_supplier_party.tin", source: "seller.tin" },
        { target: "accounting_supplier_party.party_name", source: "seller.name" },
      ],
      array_mappings: [
        {
          source_array: "line_items",
          target_array: "invoice_line",
          item_mappings: [
            { target: "item.name", source: "item_title" },
            { target: "invoiced_quantity", source: "quantity", transform: "toNumber" },
            { target: "price.price_amount", source: "unit_cost", transform: "toNumber" },
            { target: "line_extension_amount", source: "total", transform: "toNumber" },
          ],
        },
      ],
      constants: {
        document_currency_code: "NGN",
        tax_currency_code: "NGN",
        invoice_type_code: "380",
      },
    };

    const result = DeterministicMappingEngine.transform(sampleERPInvoice, template);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.irn).toBe("ORD-99881");
    expect(result.data?.issue_date).toBe("2026-09-08");
    expect(result.data?.document_currency_code).toBe("NGN");
    expect(result.data?.accounting_customer_party?.tin).toBe("22334455-0001");
    expect(result.data?.accounting_customer_party?.email).toBe("finance@acme.ng");
    expect(result.data?.invoice_line?.length).toBe(1);
    expect(result.data?.invoice_line?.[0]?.item?.name).toBe("Cloud Server Hosting");
    expect(result.data?.invoice_line?.[0]?.invoiced_quantity).toBe(2);

    // Math Healing checks
    expect(result.data?.tax_total).toBeDefined();
    expect(result.data?.legal_monetary_total).toBeDefined();
    expect(result.data?.legal_monetary_total?.payable_amount).toBeGreaterThan(0);
    expect(result.executionTimeMs).toBeLessThan(50); // High performance
  });

  it("should handle omitted fields via fallback_sources and default_value", () => {
    const payloadWithMissingFields = {
      invoice_num: "INV-5500",
      customer: {
        // primary 'tin' is missing, fallback 'tax_reg_no' is present
        tax_reg_no: "99887766-0001",
        company: "OmniCorp Ltd",
        email: "billing@omnicorp.com",
      },
      items: [
        {
          name: "Consulting Hour",
          qty: "5",
          rate: "20000",
        },
      ],
    };

    const template: MappingTemplate = {
      erp_source: "QUICKBOOKS",
      nrs_schema_version: "v1.0",
      field_mappings: [
        {
          target: "irn",
          source: "invoice_id",
          fallback_sources: ["invoice_num", "ref_no"],
        },
        {
          target: "accounting_customer_party.tin",
          source: "customer.tin",
          fallback_sources: ["customer.tax_reg_no", "customer.vat_id"],
        },
        {
          target: "accounting_customer_party.party_name",
          source: "customer.company",
        },
        {
          target: "accounting_customer_party.email",
          source: "customer.email",
        },
        {
          target: "document_currency_code",
          source: "currency",
          default_value: "NGN",
        },
      ],
      array_mappings: [
        {
          source_array: "items",
          target_array: "invoice_line",
          item_mappings: [
            { target: "item.name", source: "name" },
            { target: "invoiced_quantity", source: "qty", transform: "toNumber" },
            { target: "price.price_amount", source: "rate", transform: "toNumber" },
            {
              target: "line_extension_amount",
              source: "amount",
              default_value: 100000,
              transform: "toNumber",
            },
          ],
        },
      ],
    };

    const result = DeterministicMappingEngine.transform(payloadWithMissingFields, template);

    expect(result.success).toBe(true);
    expect(result.data?.irn).toBe("INV-5500");
    expect(result.data?.accounting_customer_party?.tin).toBe("99887766-0001");
    expect(result.data?.document_currency_code).toBe("NGN");
    expect(result.data?.invoice_line?.[0]?.line_extension_amount).toBe(100000);
  });

  it("should fail gracefully when hard blocker fields (e.g. empty line items) are missing", () => {
    const invalidPayload = {
      order_id: "ORD-EMPTY",
      buyer: {
        tin_number: "22334455-0001",
      },
      items: [], // 0 items
    };

    const template: MappingTemplate = {
      erp_source: "CUSTOM_ERP",
      field_mappings: [{ target: "irn", source: "order_id" }],
      array_mappings: [
        {
          source_array: "items",
          target_array: "invoice_line",
          min_items: 1,
          item_mappings: [{ target: "item.name", source: "name" }],
        },
      ],
    };

    const result = DeterministicMappingEngine.transform(invalidPayload, template);

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.missingRequiredFields).toContain("invoice_line (min 1 items)");
  });
});

describe("NRSSchemaRegistry (Database-Driven)", () => {
  it("should register schema from DB and list available versions", () => {
    NRSSchemaRegistry.registerFromDB(
      "v1.0",
      "NRS / FIRS UBL 2.1 Standard",
      "Nigerian Revenue Service e-invoicing schema",
      [
        { field_id: "irn", field_path: "irn", data_type: "String", is_required: true },
        { field_id: "business_id", field_path: "business_id", data_type: "String", is_required: true },
        { field_id: "issue_date", field_path: "issue_date", data_type: "Date", is_required: true },
      ],
      true,
    );

    const schemas = NRSSchemaRegistry.listSchemas();
    expect(schemas.length).toBeGreaterThanOrEqual(1);
    expect(schemas[0].version).toBe("v1.0");

    const schema = NRSSchemaRegistry.getSchema("v1.0");
    expect(schema?.name).toContain("NRS");
    expect(schema?.requiredFields.length).toBe(3);
  });

  it("should dynamically register updated NRS schema requirements from DB and enforce them", () => {
    // Simulate NRS updating their requirements with a new mandatory field
    NRSSchemaRegistry.registerFromDB(
      "v2.0",
      "NRS UBL 2.1 Standard (v2.0 with Dynamic Fields)",
      "Updated NRS schema requiring buyer_nin",
      [
        {
          field_id: "buyer_nin",
          field_path: "accounting_customer_party.national_id",
          data_type: "String",
          is_required: true,
          description: "Buyer National Identification Number",
        },
      ],
      true,
    );

    const schema = NRSSchemaRegistry.getSchema("v2.0");
    expect(schema?.version).toBe("v2.0");
    expect(schema?.requiredFields.length).toBe(1);

    // Validate a payload missing the dynamic field
    const incompletePayload = {
      business_id: "BUS-1",
      irn: "INV-1",
      issue_date: "2026-09-08",
      accounting_supplier_party: {
        tin: "12345678",
        party_name: "Supplier",
        email: "sup@test.com",
        postal_address: { street_name: "Street", city_name: "Lagos", postal_zone: "100001", country: "NG" },
      },
      accounting_customer_party: {
        tin: "87654321",
        party_name: "Customer",
        email: "cust@test.com",
        postal_address: { street_name: "Street", city_name: "Lagos", postal_zone: "100001", country: "NG" },
        // national_id is missing!
      },
      tax_total: [{ tax_amount: 0, tax_subtotal: [{ taxable_amount: 0, tax_amount: 0, tax_category: { id: "ZERO_VAT", percent: 0 } }] }],
      legal_monetary_total: { line_extension_amount: 100, tax_exclusive_amount: 100, tax_inclusive_amount: 100, payable_amount: 100 },
      invoice_line: [{ invoiced_quantity: 1, line_extension_amount: 100, item: { name: "Item", description: "Desc" }, price: { price_amount: 100, base_quantity: 1, price_unit: "H87" } }],
    };

    const validation = NRSSchemaRegistry.validate(incompletePayload, "v2.0");
    expect(validation.success).toBe(false);
    expect(validation.errors?.[0]).toContain("accounting_customer_party.national_id");
  });
});

