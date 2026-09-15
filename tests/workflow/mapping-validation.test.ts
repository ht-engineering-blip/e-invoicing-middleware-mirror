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

import { DeterministicMappingEngine } from "../../src/v1/workflow/utils/transformer/deterministic-engine";
import type { MappingTemplate } from "../../src/v1/workflow/utils/transformer/mapping-spec.types";
import { TransformWorkflowService } from "../../src/v1/workflow/services/workflows/transform.service";

describe("Sage X3 Deterministic Transformation & Compliance Healing", () => {
  const sageX3Payload = {
    invoice: {
      SIH0_1: {
        SALFCY: "HTECH",
        ZSALFCY: "HEIRS TECHNOLOGIES HQ",
        SIVTYP: "ZAINV",
        NUM: "HTECHZAINV2512000472",
        INVDAT: "20251231",
        BPCINV: "BP0001",
        BPINAM: "United Bank for Africa",
        CUR: "NGN",
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
      ARRAY_LINE: [
        {
          ITMREF: "MGDSER",
          ITMDES: "MANAGED SERVICES",
          QTY: 1,
          NETPRI: 30000,
          LINAMT: 30000,
        },
      ],
      ARRAY_TAX: [
        {
          VACBPR: "VAT75",
          BASTAX: 30000,
          AMTTAX: 2250,
        },
      ],
    },
  };

  const sageX3Template: MappingTemplate = {
    erp_source: "sage-x3",
    nrs_schema_version: "v1.0",
    constants: {
      invoice_type_code: "380",
      invoice_kind: "B2B",
      document_currency_code: "NGN",
      tax_currency_code: "NGN",
    },
    field_mappings: [
      {
        source: "invoice.SIH0_1.NUM",
        target: "invoice_reference",
        is_required: true,
      },
      {
        source: "invoice.SIH0_1.INVDAT",
        target: "issue_date",
        transform: "toDate",
        is_required: true,
      },
      {
        source: null,
        target: "accounting_supplier_party.tin",
        default_value: "{{SUPPLIER_TIN}}",
        is_required: true,
      },
      {
        source: null,
        target: "accounting_supplier_party.party_name",
        default_value: "{{SUPPLIER_NAME}}",
        is_required: true,
      },
      {
        source: null,
        target: "accounting_supplier_party.email",
        default_value: "{{SUPPLIER_EMAIL}}",
        is_required: false,
      },
      {
        source: "invoice.SIH0_1.BPCINV",
        target: "accounting_customer_party.tin",
        is_required: true,
      },
      {
        source: "invoice.SIH0_1.BPINAM",
        target: "accounting_customer_party.party_name",
        is_required: true,
      },
    ],
    array_mappings: [
      {
        source_array: "invoice.ARRAY_LINE",
        target_array: "invoice_line",
        min_items: 1,
        item_mappings: [
          {
            source: "ITMDES",
            target: "item.name",
            is_required: true,
          },
          {
            source: "ITMDES",
            target: "item.description",
            is_required: true,
          },
          {
            source: "ITMREF",
            target: "item.sellers_item_identification",
          },
          {
            source: "QTY",
            target: "invoiced_quantity",
            transform: "toNumber",
            is_required: true,
          },
          {
            source: "NETPRI",
            target: "price.price_amount",
            transform: "toNumber",
            is_required: true,
          },
          {
            source: "LINAMT",
            target: "line_extension_amount",
            transform: "toNumber",
            is_required: true,
          },
        ],
      },
      {
        source_array: "invoice.ARRAY_TAX",
        target_array: "tax_total",
        min_items: 1,
        item_mappings: [
          {
            source: "AMTTAX",
            target: "tax_amount",
            transform: "toNumber",
            is_required: true,
          },
        ],
      },
    ],
  };

  it("should transform Sage X3 payload with 100% compliance and heal all 5 previous errors", () => {
    // Admin context without explicit business profile
    const authContext = {
      tenantId: "system",
      isAdmin: true,
    };

    const result = DeterministicMappingEngine.transform(
      sageX3Payload,
      sageX3Template,
      authContext,
    );

    expect(result.success).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(result.data).toBeDefined();

    const data = result.data!;

    // 1. Supplier party name healed
    expect(data.accounting_supplier_party.party_name).toBe("Heirs Technologies HQ");

    // 2. Supplier TIN healed
    expect(data.accounting_supplier_party.tin).toBe("00364075-0001");

    // 3. Supplier email healed
    expect(data.accounting_supplier_party.email).toBe("finance@heirstechnologies.com");

    // 4. Customer email auto-generated
    expect(data.accounting_customer_party.email).toContain("@");
    expect(data.accounting_customer_party.email).toBe("billing@unitedbankforaf.com");

    // 5. Line item HSN code auto-assigned
    expect(data.invoice_line[0].hsn_code).toMatch(/^\d{4}\.\d{2}$/);

    // 6. Time, type, and status normalized
    expect(data.issue_time).toBeDefined();
    expect(data.invoice_type_code).toBe("380");
    expect(data.payment_status).toBe("PENDING");
  });

  it("should successfully pass saveMappingTemplate gatekeeper validation with full ERP payload", async () => {
    const rawSagePayloadWithComplexFields = {
      ...sageX3Payload,
      invoice: {
        ...sageX3Payload.invoice,
        SIH0_1: {
          ...sageX3Payload.invoice.SIH0_1,
          SIVTYP: "ZAINV", // raw ERP invoice type
        },
        SIH1_8: {
          INVSTA_LBL: "Not posted", // raw ERP status
        },
        ADXTEC: {
          WW_MODSTAMP: "20260819095701", // 14-digit timestamp
        },
        SIH2_5: [
          { SHO: "Discount %", INVDTAAMT: "0", INVDTATYP: "3" },
          { SHO: "Freight", INVDTAAMT: "0", INVDTATYP: "1" },
        ],
      },
    };

    const templateWithComplexFields: MappingTemplate = {
      ...sageX3Template,
      field_mappings: [
        ...sageX3Template.field_mappings,
        {
          source: "invoice.SIH0_1.SIVTYP",
          target: "invoice_type_code",
          default_value: "381",
        },
        {
          source: "invoice.SIH1_8.INVSTA_LBL",
          target: "payment_status",
          default_value: "PENDING",
        },
        {
          source: "invoice.ADXTEC.WW_MODSTAMP",
          target: "issue_time",
        },
      ],
      array_mappings: [
        ...(sageX3Template.array_mappings || []),
        {
          source_array: "invoice.SIH2_5",
          target_array: "allowance_charge",
          item_mappings: [
            {
              source: "INVDTATYP",
              target: "charge_indicator",
              transform: "toBoolean",
            },
            {
              source: "INVDTAAMT",
              target: "amount",
              transform: "toNumber",
            },
          ],
        },
      ],
    };

    const mockRepo: any = {
      findDefaultBySourceType: async () => null,
      findBySourceType: async () => [],
      upsertSchema: async () => ({ schema_id: "SAGE_SCHEMA", status: "ACTIVE" }),
    };

    const transformService = new TransformWorkflowService({
      invoiceRepo: mockRepo,
      tenantService: {} as any,
    });

    const testRes = await transformService.testMappingTemplate(
      rawSagePayloadWithComplexFields,
      templateWithComplexFields,
      { tenantId: "system", isAdmin: true },
    );

    expect(testRes.success).toBe(true);
    expect(testRes.errors).toBeUndefined();
    expect(testRes.data).toBeDefined();
    const resultData = testRes.data!;
    expect(resultData.issue_time).toBe("09:57:01"); // 14-digit to HH:MM:SS
    expect(resultData.payment_status).toBe("PENDING"); // normalized status
    expect(resultData.allowance_charge?.[0].charge_indicator).toBe(true); // boolean converted

    // Address & Product Category auto-healing checks against strict DB required fields
    const strictDBFields = [
      {
        field_id: "supplier_street",
        field_path: "accounting_supplier_party.postal_address.street_name",
        data_type: "String",
        is_required: true,
        description: "Street name of supplier address.",
      },
      {
        field_id: "supplier_city",
        field_path: "accounting_supplier_party.postal_address.city_name",
        data_type: "String",
        is_required: true,
        description: "City name of supplier address.",
      },
      {
        field_id: "supplier_postal_zone",
        field_path: "accounting_supplier_party.postal_address.postal_zone",
        data_type: "String",
        is_required: true,
        description: "Postal zone of supplier address.",
      },
      {
        field_id: "customer_street",
        field_path: "accounting_customer_party.postal_address.street_name",
        data_type: "String",
        is_required: true,
        description: "Street name of customer address.",
      },
      {
        field_id: "customer_city",
        field_path: "accounting_customer_party.postal_address.city_name",
        data_type: "String",
        is_required: true,
        description: "City name of customer address.",
      },
      {
        field_id: "customer_postal_zone",
        field_path: "accounting_customer_party.postal_address.postal_zone",
        data_type: "String",
        is_required: true,
        description: "Postal zone of customer address.",
      },
      {
        field_id: "product_category",
        field_path: "invoice_line[*].product_category",
        data_type: "String",
        is_required: true,
        description: "Product category name.",
      },
    ];

    const strictValidation = NRSSchemaRegistry.validate(resultData, "v1.0", strictDBFields);
    expect(strictValidation.success).toBe(true);
    expect(strictValidation.errors).toBeUndefined();
  });
});


