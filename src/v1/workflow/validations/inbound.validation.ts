import { t } from "elysia";
import { InboundInvoicePayloadSchema } from "./invoice-payload.schema";

export const inboundInvoiceValidation = {
  body: InboundInvoicePayloadSchema,
  query: t.Optional(
    t.Object({
      transmit: t.Optional(
        t.String({
          description: "Whether to transmit the invoice (true/false)",
          examples: ["false", "true"],
        }),
      ),
    }),
  ),
  detail: {
    tags: ["Workflow"],
    summary: "Inbound Invoice Workflow",
    description: "Process inbound workflow (download, decrypt, save, acknowledge) and optional transmit",
  },
};

