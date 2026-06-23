import { TenantSchema } from '../../shared/validations/models.schema';
import { t } from 'elysia';
import { SchemaSourceType } from '../../workflow/models';

export const listSupportedERPsValidation = {
  response: {
    200: t.Object({
      success: t.Literal(true),
      data: t.Array(
        t.Object({
          id: t.String(),
          source_type: t.String(),
          status: t.String(),
          last_updated: t.Date(),
        })
      ),
      count: t.Number(),
    }),
    500: t.Object({
      success: t.Literal(false),
      error: t.String(),
      statusCode: t.Number(),
    }),
  },
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
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Union([TenantSchema, t.Record(t.String(), t.Any())])),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
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
    metadata: t.Optional(t.Union([TenantSchema, t.Record(t.String(), t.Any())])),
  }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Union([TenantSchema, t.Record(t.String(), t.Any())])),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Optional(t.Number()),
    }),
  },
  detail: {
    tags: ['Admin - System Configuration'],
    security: [{ adminKey: [] }],
    summary: 'Add ERP Dictionary',
    description: 'Add a new ERP system invoice dictionary',
  },
};
