import { t } from 'elysia';
import { FIRS_INVOICE_METADATA, FIRS_INVOICE_SCHEMA } from '../../workflow/utils/defaults';

export const getFIRSDictionaryValidation = {
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
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
    summary: 'Get FIRS Dictionary',
    description: 'Get the current FIRS UBL invoice schema dictionary',
  },
};

export const updateFIRSDictionaryValidation = {
  body: t.Object({
    invoice: t.Any({ default: FIRS_INVOICE_SCHEMA }),
    metadata: t.Optional(t.Any({ default: FIRS_INVOICE_METADATA })),
  }),
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.Optional(t.String()),
      data: t.Optional(t.Record(t.String(), t.Any())),
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
    summary: 'Update FIRS Dictionary',
    description: 'Update the FIRS UBL invoice schema dictionary',
  },
};
