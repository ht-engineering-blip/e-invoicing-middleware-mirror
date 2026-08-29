import { OutboundInvoiceRepository } from "../../../workflow/repos/outbound-invoice.repo";
import { InboundInvoiceRepository } from "../../../workflow/repos/inbound-invoice.repo";
import { AppError, NotFoundError, ValidationError } from "../../../../@lib";
import { extractFIRSError } from "../../../shared/utils";

export type InvoicePaymentStatusType = "PENDING" | "PAID" | "REJECTED" | string;

export interface UpdateInvoiceStatusResult {
  success: boolean;
  irn: string;
  invoiceType: "outbound" | "inbound";
  status: InvoicePaymentStatusType;
  updated: boolean;
  metadata?: any;
}

/**
 * Updates payment status and metadata on outbound or inbound invoice records.
 */
export async function executeUpdateInvoiceStatusStep(params: {
  tenantId: string;
  irn: string;
  status: InvoicePaymentStatusType;
  metadata?: {
    paymentDate?: Date;
    paymentAmount?: number;
    paymentReference?: string;
    rejectionReason?: string;
  };
  outboundRepo: OutboundInvoiceRepository;
  inboundRepo: InboundInvoiceRepository;
}): Promise<UpdateInvoiceStatusResult> {
  const { tenantId, irn, status, metadata, outboundRepo, inboundRepo } = params;

  try {
    let invoice: any = await outboundRepo.findByIrn(irn);
    let invoiceType: "outbound" | "inbound" = "outbound";

    if (!invoice) {
      invoice = await inboundRepo.findByIRN(irn);
      invoiceType = "inbound";
    }

    if (!invoice) {
      throw new NotFoundError("Invoice not found");
    }

    if (invoice.tenantId !== tenantId) {
      throw new ValidationError("Invoice does not belong to this business");
    }

    const updateData: any = {
      paymentStatus: status,
      updatedAt: new Date(),
    };

    if (metadata?.paymentDate) updateData.paymentDate = metadata.paymentDate;
    if (metadata?.paymentAmount !== undefined) updateData.paymentAmount = metadata.paymentAmount;
    if (metadata?.paymentReference) updateData.paymentReference = metadata.paymentReference;
    if (metadata?.rejectionReason) updateData.rejectionReason = metadata.rejectionReason;

    if (invoiceType === "outbound") {
      await outboundRepo.update(irn, updateData);
    } else {
      await inboundRepo.update(invoice.irn, updateData);
    }

    return {
      success: true,
      irn,
      invoiceType,
      status,
      updated: true,
      metadata,
    };
  } catch (error: any) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    const { message, code } = extractFIRSError(error);
    throw new AppError(code, `Status update failed: ${message}`);
  }
}
