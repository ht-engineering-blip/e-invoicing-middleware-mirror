import { t } from 'elysia';

export const inboundInvoiceValidation = {
  body: t.Any({ default: {} }),
  detail: {
    summary: "Inbound Invoice",
    description: "Process inbound workflow and transmit invoice",
  },
};
