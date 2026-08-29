import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { TenantService } from "../../../tenants/services/tenant.service";
import { OutboundInvoiceRepository } from "../../../workflow/repos/outbound-invoice.repo";
import { AppError } from "../../../../@lib";
import { AuthContext } from "../../../../middlewares";
import { extractFIRSError } from "../../../shared/utils";

export interface GenerateQRResult {
  success: boolean;
  irn: string;
  qrCode: string;
  encryptedData: any;
}

/**
 * Generates a FIRS-compliant QR code for an invoice and attaches it to the database record.
 */
export async function executeGenerateQRStep(params: {
  authContext: AuthContext;
  irn: string;
  firsService: FIRSService;
  tenantService: TenantService;
  outboundRepo: OutboundInvoiceRepository;
}): Promise<GenerateQRResult> {
  const { authContext, irn, firsService, tenantService, outboundRepo } = params;

  try {
    const credentials = await tenantService.getFIRSCredentials(
      authContext.tenantId,
    );
    const { certificate, publicKey } = credentials;

    const qrResult = await firsService.generateQRCodeV2(
      irn,
      certificate!,
      publicKey!,
    );

    if (!qrResult?.qrCode && !qrResult?.data) {
      throw new AppError(500, "QR code generation failed");
    }

    const existingInvoice = await outboundRepo.findByIrn(irn);
    if (existingInvoice) {
      await outboundRepo.update(irn, {
        qrCode: qrResult.qrCode,
      });
    }

    return {
      success: true,
      irn,
      qrCode: qrResult.qrCode,
      encryptedData: qrResult.data,
    };
  } catch (error: any) {
    const { message, code } = extractFIRSError(error);
    throw new AppError(code, `QR generation failed: ${message}`);
  }
}
