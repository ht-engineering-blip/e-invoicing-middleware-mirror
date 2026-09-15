import { TenantSchema } from '../../shared/validations/models.schema';
import { t } from 'elysia';
import { SchemaSourceType } from '../../workflow/models';

export const listSupportedERPsValidation = {
  
  detail: {
    tags: ['Admin - System Configuration'],
    security: [{ adminKey: [] }],
    summary: 'List Supported ERPs',
    description: 'Get all configured ERP systems (excludes FIRS_UBL)',
  },
};

export const getERPDictionaryValidation = {
  params: t.Object({
    erpType: t.Union([t.Enum(SchemaSourceType), t.String()]),
  }),
  
  detail: {
    tags: ['Admin - System Configuration'],
    security: [{ adminKey: [] }],
    summary: 'Get ERP Dictionary',
    description: 'Get invoice dictionary for a specific ERP type',
  },
};

export const addERPDictionaryValidation = {
  body: t.Object({
    erp: t.Union([
      t.Enum(SchemaSourceType, { default: SchemaSourceType.CUSTOM }),
      t.String(),
    ]),
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
    metadata: t.Optional(t.Record(t.String(), t.Any())),
  }),
  
  detail: {
    tags: ['Admin - System Configuration'],
    security: [{ adminKey: [] }],
    summary: 'Add / Configure ERP Dictionary',
    description: 'Add a new ERP system invoice dictionary and mapping template with either manual or LLM-assisted mapping.',
  },
};

