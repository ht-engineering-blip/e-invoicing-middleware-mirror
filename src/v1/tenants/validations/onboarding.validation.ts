import { t } from "elysia";
import {
  updateCredentialsExample,
  updateKeyMapExample,
} from "../examples/onboarding.examples";

export const activateValidation = {
  params: t.Object({
    token: t.String(),
  }),
  detail: {
    tags: ["Onboarding"],
    summary: "Handle Activation Link",
    description:
      "Process tenant activation link and return password setting token",
  },
};

export const updateCredentialsValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Object(
    {
      publicKey: t.Optional(
        t.String({
          description: "PEM encoded RSA public key",
          example: updateCredentialsExample.publicKey,
        }),
      ),
      certificate: t.Optional(
        t.String({
          description: "PEM encoded X.509 certificate",
          example: updateCredentialsExample.certificate,
        }),
      ),
      mock: t.Optional(
        t.Boolean({
          description: "If true, populates mock FIRS credentials for testing",
          example: false,
          default: false,
        }),
      ),
      clientId: t.Optional(t.String({ description: "FIRS Client ID" })),
      serviceId: t.Optional(t.String({ description: "FIRS Service ID" })),
    },
    { examples: [updateCredentialsExample] },
  ),
  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Update Credentials",
    description:
      "Update tenant public key and certificate for FIRS integration. Pass mock: true for test provisioning.",
  },
};

export const getWebhookConfigValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }] as any,
    summary: "Get Webhook Configuration & Expiry Status",
    description:
      "Retrieve current webhook URL, enabled status, invoiceIdKey, lifespan, and expiration date for a tenant.",
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
        }),
      ),
      webhookAuthMode: t.Optional(
        t.Union(
          [
            t.Literal("auto"),
            t.Literal("hmac"),
            t.Literal("static_secret"),
            t.Literal("secret_url"),
          ],
          {
            description:
              "Webhook authentication mode: 'auto' (accepts HMAC and static secret/URL), 'hmac' (strict HMAC dynamic signature), 'static_secret' (static secret header/query/body), or 'secret_url' (capability URL).",
            default: "auto",
          },
        ),
      ),
      defaultEventType: t.Optional(
        t.String({
          description:
            "Default event type to assign to inbound webhooks when no event header or body field is provided",
          default: "invoice.received",
        }),
      ),
      lifespan: t.Optional(
        t.Union(
          [
            t.Literal("30_DAYS"),
            t.Literal("90_DAYS"),
            t.Literal("180_DAYS"),
            t.Literal("1_YEAR"),
            t.Literal("NO_EXPIRATION"),
            t.Literal("30d"),
            t.Literal("90d"),
            t.Literal("180d"),
            t.Literal("1y"),
            t.Literal("never"),
          ],
          {
            description:
              "Lifespan / expiration duration for the webhook URL and secret (30_DAYS, 90_DAYS, 180_DAYS, 1_YEAR, NO_EXPIRATION)",
            default: "NO_EXPIRATION",
          },
        ),
      ),
    }),
  ),
  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }] as any,
    summary: "Generate Webhook URL",
    description:
      "Generate a unique webhook URL for receiving inbound invoices with configurable lifespan, authentication mode (auto, hmac, static_secret, secret_url), and default event type.",
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
    }),
  ),
  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }] as any,
    summary: "Update Invoice ID Key for tenant",
    description:
      "Update invoiceIdKey to configure which payload field identifies the ERP invoice.",
  },
};

export const updateKeyMapValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Object(
    {
      eventType: t.String({
        description: "The event type (e.g. erp.creditnote.issued)",
      }),
      idKey: t.String({
        description: "Dot-notation path to the ID field in the webhook payload",
      }),
    },
    { examples: [updateKeyMapExample] },
  ),

  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }] as any,
    summary: "Update Event ID Key Mapping",
    description:
      "Add or update the mapping between an event type and its corresponding ID extraction key.",
  },
};

export const updateReferenceKeyMapValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Object(
    {
      eventType: t.String({
        description: "The event type (e.g. erp.creditnote.issued)",
      }),
      idKey: t.String({
        description:
          "Dot-notation path to the reference ID field in the webhook payload",
      }),
    },
    { examples: [updateKeyMapExample] },
  ),

  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }] as any,
    summary: "Update Event Reference ID Key Mapping",
    description:
      "Add or update the mapping between an event type and its corresponding reference document ID extraction key.",
  },
};

export const testWebhookValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Optional(
    t.Object({
      testPayload: t.Optional(t.Record(t.String(), t.Any())),
      authStrategy: t.Optional(
        t.Union([
          t.Literal("hmac"),
          t.Literal("static_secret"),
          t.Literal("bearer"),
          t.Literal("query"),
          t.Literal("body"),
          t.Literal("secret_url"),
        ]),
      ),
    }),
  ),
  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Test Webhook",
    description: "Send a test webhook to verify connectivity with configurable authentication strategy",
  },
};

export const resendTenantTokenValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  detail: {
    tags: ["Onboarding"],
    security: [{ bearerAuth: [] }] as any,
    summary: "Resend Onboarding Token",
    description:
      "Check timeframe of existing token, invalidate/delete if valid, and resend new activation token email to tenant contact email.",
  },
};

export const updateBusinessIdValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Object({
    businessId: t.String({
      minLength: 2,
      description: "The new Business ID/Client ID of the tenant",
      examples: ["a6de8bd8-43be-47b9-80a5-988ee3fb9cea"],
    }),
  }),
  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Update Tenant Business ID",
    description: "Update the business ID (which is the client ID in FIRS integration) of a tenant.",
  },
};
