import { FIRSInvoicePayloadSchema } from "./invoice-payload.schema";

export const outboundInvoiceValidation = {
  body: FIRSInvoicePayloadSchema,
  detail: {
    summary: "Outbound Invoice",
    description:
      "Process outbound invoice workflow, from validation to signing and reporting.",
  },
};
