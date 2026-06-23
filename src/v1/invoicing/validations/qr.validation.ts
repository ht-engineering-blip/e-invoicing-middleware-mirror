import { t } from 'elysia';
import { appConfig } from '../../../@config';

export const getInvoiceQRValidation = {
  params: t.Object({
    irn: t.String({ minLength: 1 }),
  }),
  
  detail: {
    summary: 'Get Invoice QR Code Image',
    description: `Returns the invoice QR code as a raw PNG binary. Use \`${appConfig?.apiBaseURL}/v1/invoicing/{irn}/qr\` directly as an \`<img src>\` value.`,
    tags: ['Misc'],
  },
};
