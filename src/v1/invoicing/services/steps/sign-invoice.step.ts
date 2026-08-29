import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { OutboundInvoiceRepository } from "../../../workflow/repos/outbound-invoice.repo";
import { OutboundInvoiceStatus } from "../../../workflow/models/outbound-invoice.model";
import { AppError } from "../../../../@lib";
import { AuthContext } from "../../../../middlewares";
import { extractFIRSError } from "../../../shared/utils";

export interface SignInvoiceResult {
  success: boolean;
  signed: boolean;
  data?: any;
  errors?: string[];
  workflowState: { signed: boolean };
}

/**
 * Signs an invoice using FIRS credentials and updates stored workflow state if IRN exists.
 */
export async function executeSignInvoiceStep(params: {
  authContext: AuthContext;
  invoice: any;
  firsService: FIRSService;
  outboundRepo: OutboundInvoiceRepository;
}): Promise<SignInvoiceResult> {
  const { authContext, invoice, firsService, outboundRepo } = params;

  try {
    const targetInvoice = invoice?.data || invoice?.invoice || invoice;
    const invoiceWithCert = {
      ...targetInvoice,
      business_id: authContext.businessId,
    };

    const signResult: any = await firsService.signInvoice(invoiceWithCert);

    if (!signResult?.data?.ok && signResult?.code !== 200) {
      const errorDetails = extractFIRSError(signResult);
      const errors = errorDetails.errors.length > 0 ? errorDetails.errors : [errorDetails.message];

      return {
        success: false,
        signed: false,
        errors,
        workflowState: { signed: false },
      };
    }

    // Update stored invoice if IRN exists and is in DB
    if (targetInvoice.irn) {
      const existing = await outboundRepo.findByIrn(targetInvoice.irn);
      if (existing) {
        await outboundRepo.update(targetInvoice.irn, {
          status: OutboundInvoiceStatus.SIGNED,
        });
        await outboundRepo.updateWorkflowState(targetInvoice.irn, {
          signed: true,
        });
      }
    }

    return {
      success: true,
      signed: true,
      data: signResult.data,
      workflowState: { signed: true },
    };
  } catch (error: any) {
    const { message, code } = extractFIRSError(error);
    throw new AppError(code, `Signing failed: ${message}`);
  }
}
