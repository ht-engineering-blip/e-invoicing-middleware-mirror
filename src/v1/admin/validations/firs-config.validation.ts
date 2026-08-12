import { SystemConfigSchema } from '../../shared/validations/models.schema';
import { t } from 'elysia';
import { FIRS_INVOICE_METADATA, FIRS_INVOICE_SCHEMA } from '../../workflow/utils/defaults';

export const getFIRSDictionaryValidation = {
  
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
  
  detail: {
    tags: ['Admin - System Configuration'],
    security: [{ adminKey: [] }],
    summary: 'Update FIRS Dictionary',
    description: 'Update the FIRS UBL invoice schema dictionary',
  },
};
