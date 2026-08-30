import { firsConfig } from "../../../../@config";
import { logger } from "../../../../@lib";
import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { extractFIRSError } from "../../../shared/utils";
import { TenantService } from "../../../tenants/services/tenant.service";

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
  private firsService: FIRSService;

  constructor(dependencies?: {
    tenantService?: TenantService;
    firsService?: FIRSService;
  }) {
    this.tenantService = dependencies?.tenantService ?? new TenantService();
    this.firsService = dependencies?.firsService ?? new FIRSService();
  }

  getFIRSError = (error: any) => extractFIRSError(error);

  async handleInboundWorkflow(
    invoice: InboundWorkflowInvoice,
    transmit: boolean = false,
  ): Promise<InboundWorkflowResponse> {
    const { irn, tenant_id } = invoice;
    try {
      if (!irn) {
        throw new Error("IRN is required to process inbound invoice");
      }

      // Step 0: Download the invoice from FIRS
      const downloadResponse = await this.firsService.downloadInvoice(irn);

      const invoiceData = downloadResponse?.data;

      if (
        !invoiceData ||
        !invoiceData.iv_hex ||
        !invoiceData.pub ||
        !invoiceData.data
      ) {
        throw new Error(`Inbound invoice '${irn}' not found or empty on FIRS`);
      }

      const decryptedData: any = await this.firsService.decryptInvoice({
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
        await this.firsService.saveInboundInvoiceToDB({
          irn,
          business_id,
          invoice,
          decryptedData,
        });
      }

      // Acknowledge invoice receipt
      try {
        await this.firsService.acknowledgeInvoiceReceipt(irn);
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
      const { message: errorMsg } = extractFIRSError(err);
      logger.error("Inbound workflow error:", { error: errorMsg, irn });
      return {
        status: false,
        error: errorMsg,
        data: null,
      };
    }
  }
}
