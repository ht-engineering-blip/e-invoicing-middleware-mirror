import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { TenantService } from "../../../tenants/services/tenant.service";
import { OutboundInvoiceStatus } from "../../models";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";


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

    private outboundRepo: OutboundInvoiceRepository;
    constructor() {
        this.tenantService = new TenantService();
        this.outboundRepo = new OutboundInvoiceRepository();
    }

    /**
     * Final step of the outbound chain: generate QR code from FIRS.
     * All prior steps (validate, sign, transmit, confirm) must already be done.
     */
    async generateQRCode(irn: string, businessId: string) {
        const firsService = new FIRSService();
        const firsCredentials = await this.tenantService.getFIRSCredentials(businessId);
        const encryptedData = await firsService.generateQRCodeV2(
            irn,
            firsCredentials.certificate,
            firsCredentials.publicKey
        );
        if (!encryptedData?.qrCode && !encryptedData?.data) {
            throw new Error('QR code generation failed');
        }
        return encryptedData;
    }

    getFIRSError(error: any) {
        console.log(error)
        let message = (error?.errors && error?.errors?.response && error?.errors?.response?.public_message ? error?.errors?.response?.public_message : "An error occured, please try again.")
        let code = (error?.errors && error?.errors?.code ? error.errors.code : 500)
        return { message, code }
    }

    async handleOutboundWorkflow(invoice: any, transmit: boolean = false) {
        const firsService = new FIRSService();

        // Load persisted workflow state so we can resume from the last success point
        const stored = invoice.irn
            ? await this.outboundRepo.findByIrn(invoice.irn).catch(() => null)
            : null;
        const wf = stored?.workflowState ?? {
            transformed: false, validated: false, signed: false,
            transmitted: false, delivered: false,
        };

        // Already fully delivered — return the stored QR code immediately
        if (wf.delivered && stored?.qrCode) {
            return { qrCode: stored.qrCode, data: stored.metadata?.firsSignedData };
        }

        try {
            // Step 0: Determine whether signing is needed.
            // If validated or signed already, skip the FIRS search (state is known).
            let skipSigning = wf.signed;
            if (!skipSigning) {
                const { data: searchedInvoice }: { data: SearchResponse } =
                    await firsService.searchInvoice(invoice.business_id, invoice.irn) as any;
                skipSigning = (searchedInvoice?.data?.items?.length ?? 0) > 0;
            }

            // Step 1: Validate
            if (!wf.validated) {
                const validatedInvoice: OkayResponse =
                    await firsService.validateInvoice(invoice) as any;
                if (validatedInvoice.code !== 200 && !validatedInvoice?.data?.ok) {
                    throw new Error('Invoice validation failed');
                }
                await this.outboundRepo.update(invoice.irn, { status: OutboundInvoiceStatus.VALIDATED });
                await this.outboundRepo.updateWorkflowState(invoice.irn, { validated: true });
                wf.validated = true;
            }

            console.log({
                skipSigning,
                alreadySigned: wf.signed
            })
            // Step 2: Sign (skip if already signed, or if FIRS already has the invoice)
            if (!skipSigning && !wf.signed) {
                const signedInvoice: OkayResponse =
                    await firsService.signInvoice(invoice) as any;
                if (signedInvoice.code !== 200 && !signedInvoice?.data?.ok) {
                    throw new Error('Invoice signing failed');
                }
                await this.outboundRepo.update(invoice.irn, { status: OutboundInvoiceStatus.SIGNED });
                await this.outboundRepo.updateWorkflowState(invoice.irn, { signed: true });
                wf.signed = true;
            }

            // Step 3: Confirm
            let toTransmit = false;
            if (!wf.transmitted) {
                const { data: confirmedInvoice }: { data: ConfirmResponse } =
                    await firsService.confirmSignedInvoice(invoice.irn) as any;
                if (confirmedInvoice.code !== 200) {
                    throw new Error('Invoice confirmation failed');
                }
                toTransmit = !confirmedInvoice?.data?.transmitted;
                await this.outboundRepo.update(invoice.irn, { status: OutboundInvoiceStatus.TRANSMITTED });
                await this.outboundRepo.updateWorkflowState(invoice.irn, { transmitted: true });
                wf.transmitted = true;
            }

            // Step 4: Generate QR code
            const firsCredentials = await this.tenantService.getFIRSCredentials(invoice.tenant_id);
            const encryptedData = await firsService.generateQRCodeV2(
                invoice.irn,
                firsCredentials.certificate,
                firsCredentials.publicKey
            );
            if (!encryptedData?.qrCode && !encryptedData?.data) {
                throw new Error('QR code generation failed');
            }
 
            
                  // Update stored invoice if exists
                  const existingInvoice = await this.outboundRepo.findByIrn(invoice.irn);
                  if (existingInvoice) {
                    await this.outboundRepo.update(invoice.irn, {
                      qrCode: encryptedData.qrCode
                    });
                  }
            

            // Step 5: Transmit
            if (transmit && (toTransmit || !wf.transmitted)) {
                await firsService.transmitInvoice(invoice.irn);
                await this.outboundRepo.update(invoice.irn, { status: OutboundInvoiceStatus.DELIVERED });
                await this.outboundRepo.updateWorkflowState(invoice.irn, { delivered: true });
            }

            return encryptedData;

        } catch (error) {
            throw error;
        }
    }
}
