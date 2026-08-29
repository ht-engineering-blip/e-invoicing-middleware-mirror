import { FIRSService, VATPostPaymentReportData } from "../../../../@lib/adapters/firs/firs.service";
import { OutboundInvoiceRepository } from "../../../workflow/repos/outbound-invoice.repo";
import { AppError } from "../../../../@lib";
import { extractFIRSError } from "../../../shared/utils";

export interface ReportVATResult {
  success: boolean;
  irn: string;
  reported: boolean;
  data: any;
}

/**
 * Reports VAT post-payment data to FIRS and records the response.
 */
export async function executeReportVATStep(params: {
  reportData: VATPostPaymentReportData;
  firsService: FIRSService;
  outboundRepo: OutboundInvoiceRepository;
}): Promise<ReportVATResult> {
  const { reportData, firsService, outboundRepo } = params;

  try {
    const reportResult: any = await firsService.reportVATPostPayment(reportData);

    const invoice = await outboundRepo.findByIrn(reportData.irn);
    if (invoice) {
      await outboundRepo.update(reportData.irn, {
        "metadata.vatReported": true,
        "metadata.vatReportedAt": new Date(),
        "metadata.vatReportResponse": reportResult?.data,
      } as any);
    }

    return {
      success: true,
      irn: reportData.irn,
      reported: true,
      data: reportResult?.data,
    };
  } catch (error: any) {
    const { message, code } = extractFIRSError(error);
    throw new AppError(code, `Report failed: ${message}`);
  }
}
