import { TenantSchema } from "../../shared/validations/models.schema";
import { t } from "elysia";
import { updateBusinessInfoExample } from "../examples/settings.examples";

export const getBusinessInfoValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  
  detail: {
    tags: ["Tenant"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Get Business Information",
    description: "Get tenant business information",
  },
};

export const updateBusinessInfoValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Object(
    {
      businessName: t.Optional(
        t.String({ example: updateBusinessInfoExample.businessName }),
      ),
      contactEmail: t.Optional(
        t.String({
          format: "email",
          example: updateBusinessInfoExample.contactEmail,
        }),
      ),
      contactPhone: t.Optional(
        t.String({ example: updateBusinessInfoExample.contactPhone }),
      ),
      address: t.Optional(
        t.Object({
          street: t.Optional(
            t.String({ example: updateBusinessInfoExample.address.street }),
          ),
          city: t.Optional(
            t.String({ example: updateBusinessInfoExample.address.city }),
          ),
          state: t.Optional(
            t.String({ example: updateBusinessInfoExample.address.state }),
          ),
          country: t.Optional(
            t.String({ example: updateBusinessInfoExample.address.country }),
          ),
          postalCode: t.Optional(
            t.String({ example: updateBusinessInfoExample.address.postalCode }),
          ),
        }),
      ),
      website: t.Optional(
        t.String({ example: updateBusinessInfoExample.website }),
      ),
      industry: t.Optional(
        t.String({ example: updateBusinessInfoExample.industry }),
      ),
    },
    { examples: [updateBusinessInfoExample] },
  ),
  
  detail: {
    tags: ["Tenant"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Update Business Information",
    description:
      "Update tenant business information (TIN and BRN cannot be changed)",
  },
};

export const requestEmailChangeValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Object({
    newEmail: t.String({
      format: "email",
      description: "New contact email address to verify and switch to",
    }),
  }),
  detail: {
    tags: ["Tenant"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Request Email Change Verification",
    description:
      "Send a verification code and confirmation link to the new email address.",
  },
};

export const verifyEmailChangeValidation = {
  params: t.Object({
    tenantId: t.String(),
  }),
  body: t.Optional(
    t.Object({
      token: t.Optional(t.String({ description: "Verification JWT token" })),
      _u: t.Optional(t.String({ description: "Verification JWT token alias" })),
    }),
  ),
  query: t.Optional(
    t.Object({
      token: t.Optional(t.String({ description: "Verification JWT token" })),
      _u: t.Optional(t.String({ description: "Verification JWT token alias" })),
    }),
  ),
  detail: {
    tags: ["Tenant"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Verify and Confirm Email Change",
    description:
      "Verify the JWT token sent to the new email address and update the tenant contact email.",
  },
};
