import { TenantSchema } from '../../shared/validations/models.schema';
import { t } from 'elysia';
import { SchemaSourceType } from '../../workflow/models';
import { testTransformExample, testValidateExample, testFullExample } from '../examples/sandbox.examples';

export const testTransformValidation = {
  body: t.Object({
    erpType: t.Union([t.Enum(SchemaSourceType), t.String()]),
    invoice: t.Any({ default: {}, examples: [testTransformExample.invoice] }),
  }, { examples: [testTransformExample] }),
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
    tags: ['Admin', 'Sandbox'],
    security: [{ adminKey: [] }],
    summary: 'Test Transform',
    description: 'Test invoice transformation from ERP format to FIRS UBL format',
  },
};

export const testValidateValidation = {
  body: t.Object({
    invoice: t.Any({ default: {}, examples: [testValidateExample.invoice] }),
  }, { examples: [testValidateExample] }),
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
    tags: ['Admin', 'Sandbox'],
    security: [{ adminKey: [] }],
    summary: 'Test Validate',
    description: 'Test invoice validation against FIRS requirements',
  },
};

export const testFullValidation = {
  body: t.Object({
    erpType: t.Union([t.Enum(SchemaSourceType), t.String()]),
    invoice: t.Any({ default: {}, examples: [testFullExample.invoice] }),
  }, { examples: [testFullExample] }),
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
    tags: ['Admin', 'Sandbox'],
    security: [{ adminKey: [] }],
    summary: 'Test Full Workflow',
    description: 'Test complete transform and validate workflow',
  },
};
