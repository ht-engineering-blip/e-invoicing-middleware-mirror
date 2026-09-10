import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import {
  testMappingValidation,
  saveMappingValidation,
  mappingTemplateSchema,
} from "../../src/v1/workflow/validations/transform.validation";

describe("Mapping Template Validation Schema", () => {
  const samplePayloadWithNullSources = {
    sample_invoice: {
      order_id: "ORD-12345",
      total_amt: 50000,
    },
    template: {
      erp_source: "ZOHO",
      nrs_schema_version: "v1.0",
      field_mappings: [
        {
          target: "irn",
          source: null,
          default_value: "{{IRN}}",
          transform: null,
          fallback_sources: null,
          is_required: null,
        },
        {
          target: "accounting_supplier_party.tin",
          source: null,
          default_value: "{{SUPPLIER_TIN}}",
        },
        {
          target: "accounting_customer_party.party_name",
          source: "customer_name",
          transform: "trim",
        },
      ],
      array_mappings: [
        {
          source_array: "items",
          target_array: "invoice_line",
          item_mappings: [
            {
              target: "item.name",
              source: "name",
            },
            {
              target: "hsn_code",
              source: null,
              default_value: "9988",
              transform: null,
              fallback_sources: null,
            },
          ],
        },
      ],
      constants: {
        document_currency_code: "NGN",
      },
    },
  };

  it("should successfully validate template with null source and optional fields in testMappingValidation", () => {
    const isValid = Value.Check(
      testMappingValidation.body,
      samplePayloadWithNullSources,
    );
    const errors = [...Value.Errors(testMappingValidation.body, samplePayloadWithNullSources)];

    expect(errors).toHaveLength(0);
    expect(isValid).toBe(true);
  });

  it("should successfully validate template with null source in saveMappingValidation", () => {
    const savePayload = {
      erp: "ZOHO",
      sample_invoice: samplePayloadWithNullSources.sample_invoice,
      template: samplePayloadWithNullSources.template,
    };

    const isValid = Value.Check(saveMappingValidation.body, savePayload);
    const errors = [...Value.Errors(saveMappingValidation.body, savePayload)];

    expect(errors).toHaveLength(0);
    expect(isValid).toBe(true);
  });

  it("should successfully validate mappingTemplateSchema directly", () => {
    const isValid = Value.Check(
      mappingTemplateSchema,
      samplePayloadWithNullSources.template,
    );
    expect(isValid).toBe(true);
  });
});

import { NRSSchemaRegistry } from "../../src/v1/workflow/utils/transformer/nrs-schema-registry";

describe("NRSSchemaRegistry Wildcard Array Validation", () => {
  const dbFields = [
    {
      field_id: "invoice_line_item_name",
      field_path: "invoice_line[*].item.name",
      data_type: "String",
      is_required: true,
      description: "Name of the product or service.",
    },
    {
      field_id: "invoice_line_item_description",
      field_path: "invoice_line[*].item.description",
      data_type: "String",
      is_required: true,
      description: "Product or service description.",
    },
    {
      field_id: "invoice_line_item",
      field_path: "invoice_line[*].item",
      data_type: "Object",
      is_required: true,
      description: "Describes the item or service.",
    },
    {
      field_id: "invoice_line_price_amount",
      field_path: "invoice_line[*].price.price_amount",
      data_type: "Number",
      is_required: true,
      description: "Amount per price unit.",
    },
    {
      field_id: "tax_total_amount",
      field_path: "tax_total[0].tax_amount",
      data_type: "Number",
      is_required: true,
      description: "Total tax amount",
    },
  ];

  it("should correctly validate payload when array wildcard fields are present", () => {
    const validPayload = {
      irn: "IRN-12345",
      invoice_line: [
        {
          item: {
            name: "Billing",
            description: "MANAGED SERVICES",
            sellers_item_identification: "MGDSER",
          },
          price: {
            price_amount: 30000,
            base_quantity: 1,
            price_unit: "UN",
          },
        },
      ],
      tax_total: [
        {
          tax_amount: 2250,
        },
      ],
    };

    const result = NRSSchemaRegistry.validate(validPayload, "v1.0", dbFields);
    expect(result.success).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("should fail validation when an array item is missing a required nested wildcard field", () => {
    const invalidPayload = {
      irn: "IRN-12345",
      invoice_line: [
        {
          item: {
            name: "Billing",
            // description is missing!
          },
          price: {
            price_amount: 30000,
          },
        },
      ],
      tax_total: [{ tax_amount: 100 }],
    };

    const result = NRSSchemaRegistry.validate(invalidPayload, "v1.0", dbFields);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.some((e) => e.includes("invoice_line[*].item.description"))).toBe(true);
  });

  it("should fail validation when required array is empty", () => {
    const emptyArrayPayload = {
      irn: "IRN-12345",
      invoice_line: [],
      tax_total: [{ tax_amount: 100 }],
    };

    const result = NRSSchemaRegistry.validate(emptyArrayPayload, "v1.0", dbFields);
    expect(result.success).toBe(false);
    expect(result.errors?.some((e) => e.includes("invoice_line[*].item.name"))).toBe(true);
  });
});

