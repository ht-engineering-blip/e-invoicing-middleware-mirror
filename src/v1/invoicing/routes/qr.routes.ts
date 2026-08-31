import Elysia from "elysia";
import { OutboundInvoiceRepository } from "../../workflow/repos/outbound-invoice.repo";
import { ResponseBuilder } from "../../../@lib";
import { requireAuth } from "../../../middlewares";
import { getInvoiceQRValidation } from "../validations/qr.validation";

/**
 * QR Code Routes
 */
const qrMgmtRoutes = new Elysia({
  prefix: "/invoice",
  detail: {
    security: [{ apiKey: [] }, { bearerToken: [] }],
  },
})
  .use(requireAuth)
  .decorate("outboundRepo", new OutboundInvoiceRepository())

  /**
   * GET /api/v1/invoicing/:irn/qr
   * Return the invoice QR code as a raw PNG image.
   * Scoped to the authenticated tenant.
   */
  .get(
    "/:irn/qr",
    async ({ params, auth, set, outboundRepo }) => {
      const invoice = await outboundRepo.findByIrn(params.irn);

      if (!invoice) {
        set.status = 404;
        return ResponseBuilder.error("Invoice not found", 404);
      }

      if (
        invoice.tenantId &&
        auth?.tenantId !== invoice.tenantId &&
        auth?.businessId !== invoice.tenantId &&
        !auth?.isAdmin
      ) {
        set.status = 403;
        return ResponseBuilder.error(
          "Forbidden: You do not have access to this invoice QR code",
          403,
        );
      }

      if (!invoice.qrCode) {
        set.status = 404;
        return ResponseBuilder.error(
          "QR code not yet generated for this invoice",
          404,
        );
      }

      // qrCode is stored as a data URI: "data:image/png;base64,<payload>"
      const base64Data = invoice.qrCode.startsWith("data:")
        ? invoice.qrCode.split(",")[1]
        : invoice.qrCode;

      const imageBuffer = Buffer.from(base64Data, "base64");

      set.headers["Content-Type"] = "image/png";
      set.headers["Content-Disposition"] = `inline; filename="${params.irn}.png"`;
      set.headers["Cache-Control"] = "public, max-age=86400";

      return imageBuffer;
    },
    getInvoiceQRValidation,
  );

export default qrMgmtRoutes;
