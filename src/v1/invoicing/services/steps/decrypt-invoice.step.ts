import { firsConfig } from "../../../../@config";
import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { AppError, NotFoundError, ValidationError } from "../../../../@lib";
import { AuthContext } from "../../../../middlewares";
import { extractFIRSError } from "../../../shared/utils";

export interface DecryptInvoiceResult {
  success: boolean;
  irn: string;
  decrypted: boolean;
  data: any;
}

/**
 * Downloads and decrypts an inbound invoice from FIRS with tenant isolation checks.
 */
export async function executeDecryptInvoiceStep(params: {
  authContext: AuthContext;
  irn: string;
  firsService: FIRSService;
}): Promise<DecryptInvoiceResult> {
  const { authContext, irn, firsService } = params;

  try {
    const invoiceResponse = await firsService.downloadInvoice(irn);
    const encryptedInvoice = invoiceResponse?.data;

    if (
      !encryptedInvoice ||
      !encryptedInvoice.iv_hex ||
      !encryptedInvoice.pub ||
      !encryptedInvoice.data
    ) {
      throw new NotFoundError("Invoice not found on FIRS");
    }

    const decrytdData = await firsService.decryptInvoice({
      iv_hex: encryptedInvoice.iv_hex,
      pub: encryptedInvoice.pub,
      ciphertext: encryptedInvoice.data,
      api_key: firsConfig?.appApiKey,
    });

    if (
      decrytdData.business_id !== authContext.businessId &&
      decrytdData.accounting_supplier_party?.tin !== authContext.businessTIN &&
      decrytdData.accounting_customer_party?.tin !== authContext.businessTIN
    ) {
      throw new ValidationError("Invoice does not belong to this business");
    }

    return {
      success: true,
      irn,
      decrypted: true,
      data: decrytdData,
    };
  } catch (error: any) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    const { message, code } = extractFIRSError(error);
    throw new AppError(code, `Decryption failed: ${message}`);
  }
}
