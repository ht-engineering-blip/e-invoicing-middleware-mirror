import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { OutboundInvoiceRepository } from "../../../workflow/repos/outbound-invoice.repo";
import { OutboundInvoiceStatus } from "../../../workflow/models/outbound-invoice.model";
import { AppError } from "../../../../@lib";
import { extractFIRSError } from "../../../shared/utils";

export interface ValidateInvoiceResult {
  success: boolean;
  valid: boolean;
  data?: unknown;
  errors?: string[];
  workflowState: { validated: boolean };
}

/**
 * Validates an invoice with FIRS and updates stored workflow state if IRN exists.
 */
export async function executeValidateInvoiceStep(params: {
  businessId: string;
  invoice: Record<string, unknown>;
  firsService: FIRSService;
  outboundRepo: OutboundInvoiceRepository;
}): Promise<ValidateInvoiceResult> {
  const { businessId, invoice, firsService, outboundRepo } = params;

  try {
    const rawTarget = (invoice?.data || invoice?.invoice || invoice) as Record<string, unknown>;
    const targetInvoice: Record<string, unknown> = { ...rawTarget, business_id: businessId };

    // Call FIRS validation API
    const validationResult: OkayResponse =
      await firsService.validateInvoice(targetInvoice);

    if (validationResult?.code !== 200 || !validationResult?.data?.ok) {
      const error = extractFIRSError(validationResult);
      const errors = error.errors.length > 0 ? error.errors : [error.message];

      return {
        success: false,
        valid: false,
        errors,
        workflowState: { validated: false },
      };
    }

    // If IRN exists, update the stored invoice in DB
    if (typeof targetInvoice.irn === "string" && targetInvoice.irn.trim() !== "") {
      const existing = await outboundRepo.findByIrn(targetInvoice.irn);
      if (existing) {
        await outboundRepo.update(targetInvoice.irn, {
          status: OutboundInvoiceStatus.VALIDATED,
        });
        await outboundRepo.updateWorkflowState(targetInvoice.irn, {
          validated: true,
        });
      }
    }

    return {
      success: true,
      valid: true,
      data: validationResult.data,
      workflowState: { validated: true },
    };
  } catch (error: unknown) {
    const { message, code } = extractFIRSError(error);
    throw new AppError(code, `Validation failed: ${message}`);
  }
}
