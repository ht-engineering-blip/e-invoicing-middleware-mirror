import { InboundInvoicePayloadSchema } from "./invoice-payload.schema";

export const inboundInvoiceValidation = {
  body: InboundInvoicePayloadSchema,
  detail: {
    summary: "Inbound Invoice",
    description: "Process inbound workflow and transmit invoice",
  },
};
