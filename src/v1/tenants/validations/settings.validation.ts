import { TenantSchema } from "../../shared/validations/models.schema";
import { t } from "elysia";
import { updateBusinessInfoExample } from "../examples/settings.examples";

export const getBusinessInfoValidation = {
  params: t.Object({
    tenantId: t.String(),
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
    tags: ["Tenant"],
    security: [{ apiKey: [] }, { bearerAuth: [] }] as any,
    summary: "Update Business Information",
    description:
      "Update tenant business information (TIN and BRN cannot be changed)",
  },
};
