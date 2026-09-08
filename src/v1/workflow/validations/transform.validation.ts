import { t } from 'elysia';
import { FIRS_INVOICE_METADATA, FIRS_INVOICE_SCHEMA } from '../utils/defaults';

export const transformInvoiceValidation = {
  body: t.Object({
    invoice: t.Any({ default: {} }),
    source_type: t.String(),
  }),
  detail: {
    summary: 'Transform Invoice',
    description: 'Transform invoice from source ERP format to FIRS UBL format using schema-based mapping',
  },
};

export const configureERPDictionaryValidation = {
  body: t.Object({
    erp: t.String(),
    invoice: t.Any({ default: {} }),
    mapping_type: t.Optional(
      t.Union([t.Literal("manual"), t.Literal("llm")], {
        default: "manual",
        description: "Mapping strategy: 'manual' (user-provided mapping) or 'llm' (AI-generated mapping)",
      }),
    ),
    mapping_template: t.Optional(t.Any()),
    mapping_rules: t.Optional(t.Array(t.Any())),
    fields: t.Optional(t.Array(t.Any())),
    metadata: t.Optional(t.Any()),
  }),
  detail: {
    tags: ['Admin - ERP Mapping'],
    security: [{ adminKey: [] }],
    summary: 'Configure ERP Invoice Dictionary & Mapping',
    description: 'Creates, tests, and updates invoice dictionary and mapping template with either manual or LLM mapping.',
  },
};

export const configureFIRSDictionaryValidation = {
  body: t.Object({
    invoice: t.Any({ default: FIRS_INVOICE_SCHEMA }),
    metadata: t.Optional(t.Any({ default: FIRS_INVOICE_METADATA })),
  }),
  detail: {
    hide: true,
    tags: ['Admin - System Configuration.Bak'],
    security: [{ adminKey: [] }],
    summary: 'Configure FIRS Dictionary',
    description: 'Creates and updates FIRS UBL invoice dictionary. Extracts field definitions from sample FIRS invoice and metadata.',
  },
};

export const generateMappingValidation = {
  body: t.Object({
    erp: t.String(),
    sample_invoice: t.Any({ default: {} }),
    nrs_version: t.Optional(t.String({ default: "v1.0" })),
  }),
  detail: {
    tags: ["Admin - ERP Mapping"],
    security: [{ adminKey: [] }],
    summary: "Generate Mapping Template via LLM",
    description: "Uses LLM once during onboarding to generate a proposed deterministic mapping template from a sample ERP invoice.",
  },
};

export const testMappingValidation = {
  body: t.Object({
    sample_invoice: t.Any({ default: {} }),
    template: t.Object({
      erp_source: t.String(),
      nrs_schema_version: t.Optional(t.String({ default: "v1.0" })),
      field_mappings: t.Array(
        t.Object({
          target: t.String(),
          source: t.Optional(t.String()),
          fallback_sources: t.Optional(t.Array(t.String())),
          default_value: t.Optional(t.Any()),
          transform: t.Optional(t.String()),
          is_required: t.Optional(t.Boolean()),
        }),
      ),
      array_mappings: t.Optional(
        t.Array(
          t.Object({
            source_array: t.String(),
            target_array: t.String(),
            item_mappings: t.Array(
              t.Object({
                target: t.String(),
                source: t.Optional(t.String()),
                fallback_sources: t.Optional(t.Array(t.String())),
                default_value: t.Optional(t.Any()),
                transform: t.Optional(t.String()),
              }),
            ),
          }),
        ),
      ),
      constants: t.Optional(t.Record(t.String(), t.Any())),
    }),
  }),
  detail: {
    tags: ["Admin - ERP Mapping"],
    security: [{ adminKey: [] }],
    summary: "Test Mapping Template",
    description: "Executes deterministic mapping template on a sample payload and validates against NRS schema rules.",
  },
};

export const saveMappingValidation = {
  body: t.Object({
    erp: t.String(),
    sample_invoice: t.Optional(t.Any()),
    template: t.Object({
      erp_source: t.String(),
      nrs_schema_version: t.Optional(t.String({ default: "v1.0" })),
      field_mappings: t.Array(
        t.Object({
          target: t.String(),
          source: t.Optional(t.String()),
          fallback_sources: t.Optional(t.Array(t.String())),
          default_value: t.Optional(t.Any()),
          transform: t.Optional(t.String()),
          is_required: t.Optional(t.Boolean()),
        }),
      ),
      array_mappings: t.Optional(
        t.Array(
          t.Object({
            source_array: t.String(),
            target_array: t.String(),
            item_mappings: t.Array(
              t.Object({
                target: t.String(),
                source: t.Optional(t.String()),
                fallback_sources: t.Optional(t.Array(t.String())),
                default_value: t.Optional(t.Any()),
                transform: t.Optional(t.String()),
              }),
            ),
          }),
        ),
      ),
      constants: t.Optional(t.Record(t.String(), t.Any())),
    }),
  }),
  detail: {
    tags: ["Admin - ERP Mapping"],
    security: [{ adminKey: [] }],
    summary: "Save Mapping Template",
    description: "Validates the sample payload against NRS schema rules and saves the active deterministic mapping template for the specified ERP source.",
  },
};


