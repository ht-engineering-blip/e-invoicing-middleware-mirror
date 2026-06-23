import { TenantSchema } from "../../shared/validations/models.schema";
import { t } from "elysia";
import {
  updateCredentialsExample,
  generateWebhookExample,
  updateInvoiceIdKeyExample,
  testWebhookExample,
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
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.String(),
      data: t.Object({
        tenantId: t.String(),
        businessName: t.String(),
        email: t.String(),
        setPasswordToken: t.String(),
        redirectUrl: t.String(),
      }),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
  },
};

export const updateCredentialsValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Object(
    {
      publicKey: t.String({
        minLength: 1,
        example: updateCredentialsExample.publicKey,
      }),
      certificate: t.String({
        minLength: 1,
        example: updateCredentialsExample.certificate,
      }),
    },
    { examples: [updateCredentialsExample] },
  ),
  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Update Credentials",
    description:
      "Update tenant public key and certificate for FIRS integration",
  },
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.String(),
      data: t.Object({
        tenantId: t.String(),
        hasCredentials: t.Boolean(),
      }),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
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
    }),
  ),
  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }, { adminKey: [] }] as any,
    summary: "Generate Webhook URL",
    description:
      "Generate a unique webhook URL for receiving inbound invoices. Optionally set invoiceIdKey to configure which payload field identifies the ERP invoice.",
  },
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.String(),
      data: t.Object({
        webhookUrl: t.String(),
        webhookSecret: t.String(),
        webhookPath: t.String(),
        invoiceIdKey: t.Union([t.String(), t.Null()]),
        instructions: t.String(),
      }),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
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
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.String(),
      data: t.Object({
        invoiceIdKey: t.Union([t.String(), t.Null()]),
      }),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
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
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.String(),
      data: t.Object({
        eventType: t.String(),
        idKey: t.String(),
      }),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
  },
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
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.String(),
      data: t.Object({
        eventType: t.String(),
        idKey: t.String(),
      }),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
  },
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
    }),
  ),
  detail: {
    tags: ["Onboarding"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Test Webhook",
    description: "Send a test webhook to verify connectivity",
  },
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.String(),
      data: t.Object({
        webhookUrl: t.String(),
        testResult: t.Any(),
        payload: t.Any(),
      }),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
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
  response: {
    200: t.Object({
      success: t.Boolean(),
      message: t.String(),
    }),
    400: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
    404: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
    500: t.Object({
      success: t.Boolean(),
      error: t.String(),
      statusCode: t.Number(),
    }),
  },
};
