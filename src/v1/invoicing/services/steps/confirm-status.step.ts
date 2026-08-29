import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { AppError } from "../../../../@lib";
import { extractFIRSError } from "../../../shared/utils";

export interface ConfirmInvoiceStatusResult {
  success: boolean;
  irn: string;
  found: boolean;
  message?: string;
  firsStatus?: {
    paymentStatus: string;
    entryStatus: string;
    transmitted: boolean;
    delivered: boolean;
    issueDate: string;
    dueDate: string;
    syncDate: string;
  };
}

/**
 * Checks and confirms the status of an invoice on FIRS.
 */
export async function executeConfirmStatusStep(params: {
  businessId: string;
  irn: string;
  firsService: FIRSService;
}): Promise<ConfirmInvoiceStatusResult> {
  const { businessId, irn, firsService } = params;

  try {
    const searchResult = await firsService.searchInvoice(businessId, irn);
    const result = searchResult.data;

    if (!result?.data?.items || result.data.items.length === 0) {
      return {
        success: true,
        irn,
        found: false,
        message: "Invoice not found on FIRS",
      };
    }

    const firsInvoice = result.data.items[0];
    const confirmResult: any = await firsService.confirmSignedInvoice(irn);

    return {
      success: true,
      irn,
      found: true,
      firsStatus: {
        paymentStatus: firsInvoice.payment_status,
        entryStatus: firsInvoice.entry_status,
        transmitted: confirmResult?.data?.transmitted || false,
        delivered: confirmResult?.data?.delivered || false,
        issueDate: firsInvoice.issue_date.toISOString(),
        dueDate: firsInvoice.due_date.toISOString(),
        syncDate: firsInvoice.sync_date.toISOString(),
      },
    };
  } catch (error: any) {
    const { message, code } = extractFIRSError(error);
    throw new AppError(code, `Status check failed: ${message}`);
  }
}
