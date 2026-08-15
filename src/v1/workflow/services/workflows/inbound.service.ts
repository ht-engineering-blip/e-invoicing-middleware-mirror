import { firsConfig } from "../../../../@config";
import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import type {
  FIRSDownloadInvoiceResponse,
  FIRSDownloadedInvoiceData,
} from "../../../../@lib/adapters/firs/types";
import { TenantService } from "../../../tenants/services/tenant.service";
import { logger } from "../../../../@lib";

export interface InboundWorkflowInvoice {
  irn: string;
  tenant_id: string;
  business_id?: string;
  [key: string]: unknown;
}

export interface InboundWorkflowResponse<T = unknown> {
  status: boolean;
  data: T | null;
  error?: string;
}

export class InboundWorkflowService {
  private tenantService: TenantService;

  constructor() {
    this.tenantService = new TenantService();
  }

  getFIRSError(error: any) {
    console.log(error);
    let message =
      error?.errors &&
      error?.errors?.response &&
      error?.errors?.response?.public_message
        ? error?.errors?.response?.public_message
        : "An error occured, please try again.";
    let code = error?.errors && error?.errors?.code ? error.errors.code : 500;
    return { message, code };
  }

  async handleInboundWorkflow(
    invoice: InboundWorkflowInvoice,
    transmit: boolean = false,
  ): Promise<InboundWorkflowResponse> {
    const firsService = new FIRSService();
    const { irn, tenant_id } = invoice;
    try {
      if (!irn) {
        throw new Error("IRN is required to process inbound invoice");
      }

      // Step 0: Download the invoice from FIRS
      const downloadResponse: FIRSDownloadInvoiceResponse =
        await firsService.downloadInvoice(tenant_id, irn);

      const invoiceData: FIRSDownloadedInvoiceData = downloadResponse?.data;

      if (
        !invoiceData ||
        !invoiceData.iv_hex ||
        !invoiceData.pub ||
        !invoiceData.data
      ) {
        throw new Error(`Inbound invoice '${irn}' not found or empty on FIRS`);
      }

      const decryptedData: any = await firsService.decryptInvoice({
        iv_hex: invoiceData.iv_hex,
        pub: invoiceData.pub,
        ciphertext: invoiceData.data,
        api_key: firsConfig?.appApiKey,
      });

      if (!decryptedData) {
        throw new Error(`Failed to decrypt inbound invoice '${irn}'`);
      }

      const business_id = decryptedData.business_id || invoice.business_id;
      if (irn && business_id) {
        // Persist the invoice to the database
        await firsService.saveInboundInvoiceToDB({
          irn,
          business_id,
          invoice,
          decryptedData,
        });
      }

      // Acknowledge invoice receipt
      try {
        await firsService.acknowledgeInvoiceReceipt(tenant_id, irn);
      } catch (ackError: any) {
        logger.warn(`Failed to acknowledge invoice receipt for ${irn}:`, {
          error: ackError.message,
        });
      }

      return {
        status: true,
        data: decryptedData,
      };
    } catch (err: any) {
      const errorMsg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Inbound workflow error";
      logger.error("Inbound workflow error:", { error: errorMsg, irn });
      return {
        status: false,
        error: errorMsg,
        data: null,
      };
    }
  }
}
