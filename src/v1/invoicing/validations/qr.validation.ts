import { t } from 'elysia';
import { appConfig } from '../../../@config';

export const getInvoiceQRValidation = {
  params: t.Object({
    irn: t.String({ minLength: 1 }),
  }),
  response: {
    200: t.Any(),
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
    summary: 'Get Invoice QR Code Image',
    description: `Returns the invoice QR code as a raw PNG binary. Use \`${appConfig?.apiBaseURL}/v1/invoicing/{irn}/qr\` directly as an \`<img src>\` value.`,
    tags: ['Misc'],
  },
};
