import { t } from 'elysia';
import {
  updateCredentialsExample,
  generateWebhookExample,
  updateInvoiceIdKeyExample,
  testWebhookExample,
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
