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
    metadata: t.Optional(t.Record(t.String(), t.Any())),
  }),
  
  detail: {
    tags: ['Admin - System Configuration'],
    security: [{ adminKey: [] }],
    summary: 'Add ERP Dictionary',
    description: 'Add a new ERP system invoice dictionary',
  },
};
