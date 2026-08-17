import { t } from "elysia";
import { FIRSInvoicePayloadSchema } from "./invoice-payload.schema";

export const outboundInvoiceValidation = {
  body: FIRSInvoicePayloadSchema,
  query: t.Optional(
    t.Object({
      transmit: t.Optional(
        t.String({
          description: "Whether to transmit the invoice immediately (true/false)",
          examples: ["false", "true"],
        }),
      ),
    }),
  ),
  detail: {
    tags: ["Workflow"],
    summary: "Outbound Invoice Workflow",
    description:
      "Process outbound invoice workflow, from validation to signing, QR generation and optional reporting/transmission.",
  },
};

