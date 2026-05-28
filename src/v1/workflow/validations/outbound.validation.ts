import { t } from 'elysia';

export const outboundInvoiceValidation = {
  body: t.Object({}),
  detail: {
    summary: "Outbound Invoice",
    description: "Process outbound invoice workflow, from validation to signing and reporting.",
  },
};
