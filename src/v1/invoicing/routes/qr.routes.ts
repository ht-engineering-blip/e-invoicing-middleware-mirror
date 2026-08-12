import Elysia from 'elysia';
import { OutboundInvoiceRepository } from '../../workflow/repos/outbound-invoice.repo';
import { getInvoiceQRValidation } from '../validations/qr.validation';

const outboundRepo = new OutboundInvoiceRepository();

/**
 * QR Code Routes
 */
const qrMgmtRoutes = new Elysia({
    prefix: '/invoice', detail: {
        security: [{ apiKey: [] }, {bearerToken: []}],
    }
})
  //.use(requireAuth)

  /**
   * GET /api/v1/invoicing/:irn/qr
   * Return the invoice QR code as a raw PNG image.
   * Can be used directly in <img src="..."> tags.
   */
  .get(
    '/:irn/qr',
    async ({ params, set }) => {
      const invoice = await outboundRepo.findByIrn(params.irn);

      if (!invoice) {
        set.status = 404;
        return { success: false, error: 'Invoice not found' };
      }
 

      if (!invoice.qrCode) {
        set.status = 404;
        return { success: false, error: 'QR code not yet generated for this invoice' };
      }

      // qrCode is stored as a data URI: "data:image/png;base64,<payload>"
      const base64Data = invoice.qrCode.startsWith('data:')
        ? invoice.qrCode.split(',')[1]
        : invoice.qrCode;

      const imageBuffer = Buffer.from(base64Data, 'base64');

      set.headers['Content-Type'] = 'image/png';
      set.headers['Content-Disposition'] = `inline; filename="${params.irn}.png"`;
      set.headers['Cache-Control'] = 'public, max-age=86400';

      return imageBuffer;
    },
    getInvoiceQRValidation
  );

export default qrMgmtRoutes;
