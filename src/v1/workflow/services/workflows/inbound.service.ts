import { firsConfig } from "../../../../@config";
import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { TenantService } from "../../../tenants/services/tenant.service";

export class InboundWorkflowService {
    private tenantService: TenantService;

    constructor() {
        this.tenantService = new TenantService();
    }

    getFIRSError(error: any) {
        console.log(error)
        let message = (error?.errors && error?.errors?.response && error?.errors?.response?.public_message ? error?.errors?.response?.public_message : "An error occured, please try again.")
        let code = (error?.errors && error?.errors?.code ? error.errors.code : 500)
        return { message, code }
    }

    async handleInboundWorkflow(invoice: any, transmit: boolean = false) {
        let firsService = new FIRSService();
        let { irn } = invoice; 
        try {
            // Step 0: Download the invoice from FIRS
            const { data: invoiceResponse } = await firsService.downloadInvoice(irn) as any;
            const invoice = invoiceResponse.data;

            const decryptedData = await firsService.decryptInvoice({
                iv_hex: invoice.iv_hex,
                pub: invoice.pub,
                ciphertext: invoice.data,
                api_key: firsConfig?.apiKey
            });
            let { business_id } = decryptedData;
            if (irn && business_id) {
                // Persist the invoice to the database
                await firsService.saveInboundInvoiceToDB({ irn, business_id, invoice, decryptedData });
            }

            // Acknowledge invoice receipt
            await firsService.acknowledgeInvoiceReceipt(irn);

            return {
                status: true,
                data: decryptedData
            };

        } catch (err) {
            console.error('Decryption error:', err);
            return {
                status: false,
                error: err instanceof Error ? err.message : 'Unknown decryption error',
                data: null
            };
        }
    }
}
