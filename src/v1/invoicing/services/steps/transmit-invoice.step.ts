import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { OutboundInvoiceRepository } from "../../../workflow/repos/outbound-invoice.repo";
import { OutboundInvoiceStatus } from "../../../workflow/models/outbound-invoice.model";
import { AppError, ValidationError } from "../../../../@lib";
import { AuthContext } from "../../../../middlewares";
import { extractFIRSError } from "../../../shared/utils";

export interface TransmitInvoiceResult {
  success: boolean;
  irn: string;
  transmitted: boolean;
  data: any;
  workflowState: { transmitted: boolean };
}

/**
 * Transmits a signed invoice to FIRS and updates its workflow status to TRANSMITTED.
 */
export async function executeTransmitInvoiceStep(params: {
  authContext: AuthContext;
  irn: string;
  firsService: FIRSService;
  outboundRepo: OutboundInvoiceRepository;
}): Promise<TransmitInvoiceResult> {
  const { authContext, irn, firsService, outboundRepo } = params;

  try {
    const invoice = await outboundRepo.findByIrn(irn);
    if (invoice && invoice.tenantId !== authContext.tenantId) {
      throw new ValidationError("Invoice does not belong to this business");
    }

    let transmitData: unknown;
    try {
      transmitData = await firsService.transmitInvoice(irn);
    } catch (transmitErr: unknown) {
      // Check if invoice is already signed and confirmed on FIRS
      const confirmed = await firsService.confirmSignedInvoice(irn).catch(() => null);
      if (confirmed?.data?.code === 200 || confirmed?.data?.data) {
        transmitData = confirmed.data;
      } else {
        const { message, code } = extractFIRSError(transmitErr);
        throw new AppError(code, `Transmission failed: ${message}`);
      }
    }

    if (invoice) {
      await outboundRepo.update(irn, {
        status: OutboundInvoiceStatus.TRANSMITTED,
      });
      await outboundRepo.updateWorkflowState(irn, { transmitted: true });
    }

    return {
      success: true,
      irn,
      transmitted: true,
      data: transmitData,
      workflowState: { transmitted: true },
    };
  } catch (error: unknown) {
    if (error instanceof ValidationError || error instanceof AppError) throw error;
    const { message, code } = extractFIRSError(error);
    throw new AppError(code, `Transmission failed: ${message}`);
  }
}
