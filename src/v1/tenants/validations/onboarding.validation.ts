import { t } from 'elysia';
import {
  updateCredentialsExample,
  generateWebhookExample,
  updateInvoiceIdKeyExample,
  testWebhookExample,
  updateKeyMapExample,
} from '../examples/onboarding.examples';

export const activateValidation = {
  params: t.Object({
    token: t.String(),
  }),
  detail: {
    tags: ['Onboarding'],
    summary: 'Handle Activation Link',
    description: 'Process tenant activation link and return password setting token',
  },
};

export const updateCredentialsValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Object({
    publicKey: t.String({ minLength: 1, example: updateCredentialsExample.publicKey }),
    certificate: t.String({ minLength: 1, example: updateCredentialsExample.certificate }),
  }, { examples: [updateCredentialsExample] }),
  detail: {
    tags: ['Onboarding'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Update Credentials',
    description: 'Update tenant public key and certificate for FIRS integration',
  },
};

export const generateWebhookValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Optional(
    t.Object({
      invoiceIdKey: t.Optional(
        t.String({
          description:
            'Dot-notation path to the invoice ID field in the webhook payload (e.g. "invoiceNumber" or "invoice.documentId")',
        })
      ),
    })
  ),
  detail: {
    tags: ['Onboarding'],
    security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }] as any,
    summary: 'Generate Webhook URL',
    description:
      'Generate a unique webhook URL for receiving inbound invoices. Optionally set invoiceIdKey to configure which payload field identifies the ERP invoice.',
  },
};

export const updateInvoiceIdKeyValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Optional(
    t.Object({
      invoiceIdKey: t.String({
        description:
          'Dot-notation path to the invoice ID field in the webhook payload (e.g. "invoiceNumber" or "invoice.documentId")',
      }),
    })
  ),
  detail: {
    tags: ['Onboarding'],
    security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }] as any,
    summary: 'Update Invoice ID Key for tenant',
    description:
      'Update invoiceIdKey to configure which payload field identifies the ERP invoice.',
  },
};

export const updateKeyMapValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Object({
    eventType: t.String({
      description: 'The event type (e.g. erp.creditnote.issued)'
    }),
    idKey: t.String({
      description: 'Dot-notation path to the ID field in the webhook payload'
    }),
  }, { examples: [updateKeyMapExample] }),
  detail: {
    tags: ['Onboarding'],
    security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }] as any,
    summary: 'Update Event ID Key Mapping',
    description: 'Add or update the mapping between an event type and its corresponding ID extraction key.',
  },
};

export const testWebhookValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Optional(
    t.Object({
      testPayload: t.Optional(t.Record(t.String(), t.Any())),
    })
  ),
  detail: {
    tags: ['Onboarding'],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: 'Test Webhook',
    description: 'Send a test webhook to verify connectivity',
  },
};

export const resendTenantTokenValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  detail: {
    tags: ['Onboarding'],
    security: [{ bearerAuth: [] }] as any,
    summary: 'Resend Onboarding Token',
    description: 'Check timeframe of existing token, invalidate/delete if valid, and resend new activation token email to tenant contact email.',
  },
};
