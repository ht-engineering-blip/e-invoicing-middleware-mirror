/**
 * Invoice Workflow Service
 * Handles individual invoice operations for the e-invoicing workflow
 */

import { firsConfig } from '../../../@config';
import { FIRSService, VATPostPaymentReportData } from '../../../@lib/adapters/firs/firs.service';
import { TenantService } from '../../tenants/services/tenant.service';
import { OutboundInvoiceRepository } from '../../workflow/repos/outbound-invoice.repo';
import { InboundInvoiceRepository } from '../../workflow/repos/inbound-invoice.repo';
import { OutboundInvoiceStatus, type OutboundInvoiceDocument } from '../../workflow/models/outbound-invoice.model';
import { AppError, NotFoundError, ValidationError } from '../../../@lib';
import { TransformWorkflowService } from '../../workflow/services/workflows/transform.service';
import { InboundInvoiceStatus } from '../../workflow/models';
import { AuthContext } from '../../../middlewares';


/**
 * Invoice Workflow Service
 */
export class InvoiceWorkflowService {
  private firsService: FIRSService;
  private tenantService: TenantService;
  private outboundRepo: OutboundInvoiceRepository;
  private inboundRepo: InboundInvoiceRepository;
  private transformService: TransformWorkflowService;

  constructor() {
    this.firsService = new FIRSService();
    this.tenantService = new TenantService();
    this.outboundRepo = new OutboundInvoiceRepository();
    this.inboundRepo = new InboundInvoiceRepository();
    this.transformService = new TransformWorkflowService();
  }

  /**
   * Format FIRS error for consistent error handling
   */
  private getFIRSError(error: any) {
    const message = error?.errors?.response?.public_message
      || error?.message
      || 'An error occurred, please try again.';
    const code = error?.errors?.code || error?.statusCode || 500;
    return { message, code };
  }



  /**
   * Transform Invoice
   * Transforms invoice data to FIRS UBL format
   */
  async transformInvoice(invoice: any, authContext?: AuthContext): Promise<any> {
    try {
      const transformedPayload = await this.transformService.transformInvoice(invoice, authContext);
      // If we have an IRN, update the stored invoice
      if (transformedPayload.irn) {
        let createPayload: OutboundInvoiceDocument = {
          ...transformedPayload,
          tenantId: authContext?.tenantId,
          erpSystem: authContext?.tenantERP,
          createdBy: authContext?.tenantId
        }
        await this.outboundRepo.create(createPayload);
        await this.outboundRepo.updateWorkflowState(invoice.irn, { transformed: true });
      }

      return {
        success: true,
        data: transformedPayload,
        workflowState: { transformed: true },
      };
    } catch (error: any) {
      const { message, code } = this.getFIRSError(error);
      throw new AppError(code, `Transform failed: ${message}`);
    }
  }

  /**
   * Validate Invoice
   * Validates invoice against FIRS requirements
   */
  async validateInvoice(businessId: string, invoice: any): Promise<any> {
    try {
      // Ensure business_id is set
      invoice.business_id = businessId;

      console.log(JSON.stringify({ invoice }, undefined, 2))

      // Call FIRS validation API
      const validationResult: any = await this.firsService.validateInvoice(invoice);

      if (validationResult?.code !== 200 || !validationResult?.data?.ok) {
        return {
          success: false,
          valid: false,
          errors: validationResult?.data?.errors || ['Validation failed'],
          workflowState: { validated: false },
        };
      }

      // If we have an IRN, update the stored invoice
      if (invoice.irn) {
        await this.outboundRepo.update(invoice.irn, {
          status: OutboundInvoiceStatus.VALIDATED,
        });
        await this.outboundRepo.updateWorkflowState(invoice.irn, { validated: true });
      }

      return {
        success: true,
        valid: true,
        data: validationResult.data,
        workflowState: { validated: true },
      };
    } catch (error: any) {
      const { message, code } = this.getFIRSError(error);
      throw new AppError(code, `Validation failed: ${message}`);
    }
  }

  /**
   * Sign Invoice
   * Signs the invoice using tenant's FIRS credentials
   */
  async signInvoice(authContext: AuthContext, invoice: any): Promise<any> {
    try {

      // Get FIRS credentials for signing
      const credentials = await this.tenantService.getFIRSCredentials(authContext.tenantId);

      // Prepare invoice with certificate
      const invoiceWithCert = {
        ...invoice,
        business_id: authContext.businessId,
        //certificate: credentials.certificate,
      };
      // Call FIRS sign API
      const signResult: any = await this.firsService.signInvoice(invoiceWithCert);

      if (signResult?.code !== 200 || !signResult?.data?.ok) {
        return {
          success: false,
          signed: false,
          errors: signResult?.data?.errors || ['Signing failed'],
          workflowState: { signed: false },
        };
      }

      // Update stored invoice if IRN exists
      if (invoice.irn) {
        await this.outboundRepo.update(invoice.irn, {
          status: OutboundInvoiceStatus.SIGNED,
        });
        await this.outboundRepo.updateWorkflowState(invoice.irn, { signed: true });
      }

      return {
        success: true,
        signed: true,
        data: signResult.data,
        workflowState: { signed: true },
      };
    } catch (error: any) {
      const { message, code } = this.getFIRSError(error);
      throw new AppError(code, `Signing failed: ${message}`);
    }
  }

  /**
   * Generate QR Code
   * Generates QR code for the invoice using tenant's credentials
   */
  async generateQR(authContext: AuthContext, irn: string): Promise<any> {
    try {

      const credentials = await this.tenantService.getFIRSCredentials(authContext.tenantId);
      const { certificate, publicKey } = credentials;

      // Generate QR code
      const qrResult = await this.firsService.generateQRCodeV2(irn, certificate, publicKey);

      if (!qrResult?.qrCode && !qrResult?.data) {
        throw new AppError(500, 'QR code generation failed');
      }

      // Update stored invoice if exists
      const existingInvoice = await this.outboundRepo.findByIrn(irn);
      if (existingInvoice) {
        await this.outboundRepo.update(irn, {
          qrCode: qrResult.qrCode
        });
      }

      return {
        success: true,
        irn,
        qrCode: qrResult.qrCode,
        encryptedData: qrResult.data,
      };
    } catch (error: any) {
      const { message, code } = this.getFIRSError(error);
      throw new AppError(code, `QR generation failed: ${message}`);
    }
  }

  /**
   * Transmit Invoice
   * Transmits the signed invoice to FIRS
   */
  async transmitInvoice(authContext: AuthContext, irn: string): Promise<any> {
    try {
      // Verify invoice exists and is ready for transmission
      const invoice = await this.outboundRepo.findByIrn(irn);
      if (invoice && invoice.tenantId !== authContext.tenantId) {
        throw new ValidationError('Invoice does not belong to this business');
      }

      // Call FIRS transmit API
      const transmitResult: any = await this.firsService.transmitInvoice(irn);

      // Update stored invoice if exists
      if (invoice) {
        await this.outboundRepo.update(irn, {
          status: OutboundInvoiceStatus.TRANSMITTED,
          //  firsResponse: transmitResult?.data,
        });
        await this.outboundRepo.updateWorkflowState(irn, { transmitted: true });
      }

      return {
        success: true,
        irn,
        transmitted: true,
        data: transmitResult?.data,
        workflowState: { transmitted: true },
      };
    } catch (error: any) {
      const { message, code } = this.getFIRSError(error);
      throw new AppError(code, `Transmission failed: ${message}`);
    }
  }

  /**
   * Decrypt Invoice (Inbound)
   * Downloads and decrypts an inbound invoice from FIRS
   */
  async decryptInvoice(authContext: AuthContext, irn: string): Promise<any> {
    try {
      // Download invoice from FIRS
      const { data: invoiceResponse }: any = await this.firsService.downloadInvoice(irn);
      const encryptedInvoice = invoiceResponse?.data;

      if (!encryptedInvoice) {
        throw new NotFoundError('Invoice not found on FIRS');
      }

      // Decrypt the invoice
      const decryptedData = await this.firsService.decryptInvoice({
        iv_hex: encryptedInvoice.iv_hex,
        pub: encryptedInvoice.pub,
        ciphertext: encryptedInvoice.data,
        api_key: firsConfig?.apiKey,
      });

      // Scope decryption to invoices owned by the authenticated tenant
      if (
        decryptedData.business_id !== authContext.businessId &&
        decryptedData.accounting_supplier_party?.tin !== authContext.businessTIN &&
        decryptedData.accounting_customer_party?.tin !== authContext.businessTIN
      ) {
        throw new ValidationError('Invoice does not belong to this business');
      }

      return {
        success: true,
        irn,
        decrypted: true,
        data: decryptedData,
      };
    } catch (error: any) {
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }
      const { message, code } = this.getFIRSError(error);
      throw new AppError(code, `Decryption failed: ${message}`);
    }
  }

  /**
   * Acknowledge Invoice Receipt
   * Acknowledges receipt of an inbound invoice
   */
  async acknowledgeInvoiceReceipt(businessId: string, irn: string, message?: string): Promise<any> {
    try {
      // Call FIRS acknowledge API
      const ackResult: any = await this.firsService.acknowledgeInvoiceReceipt(irn);

      // Update inbound invoice if exists
      const inboundInvoice = await this.inboundRepo.findByIRN(irn);
      if (inboundInvoice && inboundInvoice.businessId === businessId) {
        await this.inboundRepo.update(irn, {
          status: InboundInvoiceStatus.ACKNOWLEDGED,
          acknowledgedAt: new Date(),
        });
      }

      return {
        success: true,
        irn,
        acknowledged: true,
        data: ackResult?.data,
      };
    } catch (error: any) {
      const { message: errMsg, code } = this.getFIRSError(error);
      throw new AppError(code, `Acknowledgement failed: ${errMsg}`);
    }
  }

  /**
   * Update Invoice Status
   * Updates the payment status of an invoice (PENDING, PAID, REJECTED)
   */
  async updateInvoiceStatus(
    tenantId: string,
    irn: string,
    status: InvoicePaymentStatus,
    metadata?: {
      paymentDate?: Date;
      paymentAmount?: number;
      paymentReference?: string;
      rejectionReason?: string;
    }
  ): Promise<any> {
    try {
      // Check outbound invoice first
      let invoice: any = await this.outboundRepo.findByIrn(irn);
      let invoiceType = 'outbound';

      if (!invoice) {
        // Check inbound invoice
        invoice = await this.inboundRepo.findByIRN(irn);
        invoiceType = 'inbound';
      }

      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      if (invoice.tenantId !== tenantId) {
        throw new ValidationError('Invoice does not belong to this business');
      }

      const updateData: any = {
        paymentStatus: status,
        updatedAt: new Date(),
      };

      if (metadata?.paymentDate) updateData.paymentDate = metadata.paymentDate;
      if (metadata?.paymentAmount) updateData.paymentAmount = metadata.paymentAmount;
      if (metadata?.paymentReference) updateData.paymentReference = metadata.paymentReference;
      if (metadata?.rejectionReason) updateData.rejectionReason = metadata.rejectionReason;

      if (invoiceType === 'outbound') {
        await this.outboundRepo.update(irn, updateData);
      } else {
        await this.inboundRepo.update(invoice.irn, updateData);
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
      const { message, code } = this.getFIRSError(error);
      throw new AppError(code, `Status update failed: ${message}`);
    }
  }

  /**
   * Report Invoice (Post Payment)
   * Reports invoice to FIRS for VAT post-payment reporting
   *
   * @param reportData - VAT post-payment report data (see VATPostPaymentReportData interface)
   */
  async reportInvoice(reportData: VATPostPaymentReportData): Promise<any> {
    try {
      // Call FIRS VAT post-payment API
      const reportResult: any = await this.firsService.reportVATPostPayment(reportData);

      // Update invoice with report status
      const invoice = await this.outboundRepo.findByIrn(reportData.irn);
      if (invoice) {
        await this.outboundRepo.update(reportData.irn, {
          'metadata.vatReported': true,
          'metadata.vatReportedAt': new Date(),
          'metadata.vatReportResponse': reportResult?.data,
        } as any);
      }

      return {
        success: true,
        irn: reportData.irn,
        reported: true,
        data: reportResult?.data,
      };
    } catch (error: any) {
      const { message, code } = this.getFIRSError(error);
      throw new AppError(code, `Report failed: ${message}`);
    }
  }

  /**
   * Get Invoice Status from FIRS
   * Confirms the status of an invoice on FIRS
   */
  async confirmInvoiceStatus(businessId: string, irn: string): Promise<any> {
    try {
      // Search for invoice on FIRS
      const searchResult: any = await this.firsService.searchInvoice(businessId, irn);

      if (!searchResult?.data?.items || searchResult.data.items.length === 0) {
        return {
          success: true,
          irn,
          found: false,
          message: 'Invoice not found on FIRS',
        };
      }

      const firsInvoice = searchResult.data.items[0];

      // Confirm signed invoice status
      const confirmResult: any = await this.firsService.confirmSignedInvoice(irn);

      return {
        success: true,
        irn,
        found: true,
        firsStatus: {
          paymentStatus: firsInvoice.payment_status,
          entryStatus: firsInvoice.entry_status,
          transmitted: confirmResult?.data?.transmitted || false,
          delivered: confirmResult?.data?.delivered || false,
          issueDate: firsInvoice.issue_date,
          dueDate: firsInvoice.due_date,
          syncDate: firsInvoice.sync_date,
        },
      };
    } catch (error: any) {
      const { message, code } = this.getFIRSError(error);
      throw new AppError(code, `Status check failed: ${message}`);
    }
  }


}
