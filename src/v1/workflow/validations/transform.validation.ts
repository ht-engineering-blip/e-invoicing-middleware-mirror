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
    metadata: t.Optional(t.Any()),
  }),
  detail: {
    hide: true,
    tags: ['Admin - System Configuration.Bak'],
    security: [{ adminKey: [] }],
    summary: 'Configure ERP Invoice Dictionary',
    description: 'Creates and updates invoice dictionary used for mapping for supported ERPs. Extracts field definitions from sample invoice.',
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
