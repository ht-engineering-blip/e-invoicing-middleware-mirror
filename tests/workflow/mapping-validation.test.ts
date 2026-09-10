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
