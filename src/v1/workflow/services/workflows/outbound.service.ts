import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { TenantService } from "../../../tenants/services/tenant.service";


interface OkayResponse { code: number, data: { ok: boolean } }


interface ConfirmResponse {
    code: number;
    data: {
        issue_date: string;
        due_date: string;
        sync_date: string;
        payment_status: string;
        transmitted: boolean;
        delivered: boolean;
    }
}

interface SearchResponse {
    code: number;
    data: {
        items: Array<{
            irn: string;
            payment_status: string;
            entry_status: string;
            invoice_type_code: string;
            issue_date: Date;
            due_date: Date;
            sync_date: Date;
            document_currency_code: string;
            tax_currency_code: string;
        }>;
        page: {
            page: number;
            size: number;
            hasNextPage: boolean;
            hasPreviousPage: boolean;
            totalCount: number;
        }
    }
    attributes: any;

}

export class OutboundWorkflowService {
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

    async handleOutboundWorkflow(invoice: any, transmit: boolean = false) {
        try {
            let skipSigning = true
            let toTransmit = false
            // Start the workflow
            let firsService = new FIRSService();

            //Step 0: Search for the invoice
            const { data: searchedInvoice }: { data: SearchResponse } = await firsService.searchInvoice(invoice.business_id, invoice.irn) as any;
            console.log({ searchedInvoice })
            if (!searchedInvoice?.data?.items || searchedInvoice?.data?.items?.length == 0) {
                skipSigning = false
            }

            // Step 1: Validate the invoice data
            const validatedInvoice: OkayResponse = await firsService.validateInvoice(invoice) as any;
            console.log({ validatedInvoice })
            if (validatedInvoice.code !== 200 && !validatedInvoice?.data?.ok) {
                throw new Error('Invoice validation failed');
            }

            if (!skipSigning) {
                // Step 2: Sign the invoice
                const signedInvoice: OkayResponse = await firsService.signInvoice(invoice) as any;
                console.log({ signedInvoice })
                if (signedInvoice.code !== 200 && !signedInvoice?.data?.ok) {
                    throw new Error('Invoice signing failed');
                }
            }
            // Step 3: Confirm signed invoice
            const { data: confirmedInvoice }: { data: ConfirmResponse } = await firsService.confirmSignedInvoice(invoice.irn) as any;
            console.log({ confirmedInvoice })
            if (confirmedInvoice.code !== 200) {
                throw new Error('Invoice confirmation failed');
            } else {
                if (!confirmedInvoice?.data?.transmitted) {
                    toTransmit = true
                }
            }
            // Step 4: Generate QR code using customer's public key
            // Retrieve and decrypt Stored FIRS Config Using the Tenant ID
            const firsCredentials = await this.tenantService.getFIRSCredentials(invoice.business_id);
            const certificate = firsCredentials.certificate;
            const publicKey = firsCredentials.publicKey;

            const encryptedData = await firsService.generateQRCodeV2(invoice.irn, certificate, publicKey);

            if (!encryptedData?.qrCode && !encryptedData?.data) {
                throw new Error('QR code generation failed');
            }

            console.log({ toTransmit, transmit })
            if (toTransmit && transmit) {
                // Step 5: Transmit Invoice to all parties
                console.log({ "Transmit: ": invoice.irn })
                console.log("==============================")
                const transmitedInvoice = await firsService.transmitInvoice(invoice.irn);
                console.log({ transmitedInvoice })
                /* if (!transmitedInvoice.qrCode && !encryptedData.data) {
                    throw new Error('QR code generation failed');
                } */
            }
            return encryptedData;

        } catch (error) {

            throw error;
        }
    }
}
