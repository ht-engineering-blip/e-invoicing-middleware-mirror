/**
 * Invoice Workflow Service
 * Orchestrates individual invoice operations for the e-invoicing workflow
 * using reusable, modular workflow step functions.
 */

import {
  FIRSService,
  VATPostPaymentReportData,
} from "../../../@lib/adapters/firs/firs.service";
import { TenantService } from "../../tenants/services/tenant.service";
import { OutboundInvoiceRepository } from "../../workflow/repos/outbound-invoice.repo";
import { InboundInvoiceRepository } from "../../workflow/repos/inbound-invoice.repo";
import { type OutboundInvoiceDocument } from "../../workflow/models/outbound-invoice.model";
import { AppError } from "../../../@lib";
import { TransformWorkflowService } from "../../workflow/services/workflows/transform.service";
import { AuthContext } from "../../../middlewares";
import { extractFIRSError } from "../../shared/utils";
import {
  executeValidateInvoiceStep,
  executeSignInvoiceStep,
  executeGenerateQRStep,
  executeTransmitInvoiceStep,
  executeDecryptInvoiceStep,
  executeUpdateInvoiceStatusStep,
  executeReportVATStep,
  executeConfirmStatusStep,
  type InvoicePaymentStatusType,
} from "./steps";

export class InvoiceWorkflowService {
  private firsService: FIRSService;
  private tenantService: TenantService;
  private outboundRepo: OutboundInvoiceRepository;
  private inboundRepo: InboundInvoiceRepository;
  private transformService: TransformWorkflowService;

  constructor(dependencies?: {
    firsService?: FIRSService;
    tenantService?: TenantService;
    outboundRepo?: OutboundInvoiceRepository;
    inboundRepo?: InboundInvoiceRepository;
    transformService?: TransformWorkflowService;
  }) {
    this.firsService = dependencies?.firsService ?? new FIRSService();
    this.tenantService = dependencies?.tenantService ?? new TenantService();
    this.outboundRepo =
      dependencies?.outboundRepo ?? new OutboundInvoiceRepository();
    this.inboundRepo =
      dependencies?.inboundRepo ?? new InboundInvoiceRepository();
    this.transformService =
      dependencies?.transformService ?? new TransformWorkflowService();
  }

  /**
   * Format FIRS error for consistent error handling
   */
  getFIRSError(error: any) {
    return extractFIRSError(error);
  }

  /**
   * Transform Invoice to FIRS UBL format
   */
  async transformInvoice(
    invoice: any,
    authContext?: AuthContext,
  ): Promise<any> {
    try {
      const transformedPayload = await this.transformService.transformInvoice(
        invoice,
        authContext,
      );

      if (transformedPayload.irn) {
        const createPayload: Partial<OutboundInvoiceDocument> = {
          ...transformedPayload,
          tenantId: authContext?.tenantId,
          erpSystem: authContext?.tenantERP,
          createdBy: authContext?.tenantId,
        };
        await this.outboundRepo.create(createPayload as OutboundInvoiceDocument);
        await this.outboundRepo.updateWorkflowState(invoice.irn, {
          transformed: true,
        });
      }

      return {
        success: true,
        data: transformedPayload,
        workflowState: { transformed: true },
      };
    } catch (error: any) {
      const { message, code } = extractFIRSError(error);
      throw new AppError(code, `Transform failed: ${message}`);
    }
  }

  /**
   * Validate Invoice against FIRS requirements
   */
  async validateInvoice(businessId: string, invoice: any): Promise<any> {
    return executeValidateInvoiceStep({
      businessId,
      invoice,
      firsService: this.firsService,
      outboundRepo: this.outboundRepo,
    });
  }

  /**
   * Sign Invoice using tenant's FIRS credentials
   */
  async signInvoice(authContext: AuthContext, invoice: any): Promise<any> {
    return executeSignInvoiceStep({
      authContext,
      invoice,
      firsService: this.firsService,
      outboundRepo: this.outboundRepo,
    });
  }

  /**
   * Generate QR Code for invoice
   */
  async generateQR(authContext: AuthContext, irn: string): Promise<any> {
    return executeGenerateQRStep({
      authContext,
      irn,
      firsService: this.firsService,
      tenantService: this.tenantService,
      outboundRepo: this.outboundRepo,
    });
  }

  /**
   * Transmit signed invoice to FIRS
   */
  async transmitInvoice(authContext: AuthContext, irn: string): Promise<any> {
    return executeTransmitInvoiceStep({
      authContext,
      irn,
      firsService: this.firsService,
      outboundRepo: this.outboundRepo,
    });
  }

  /**
   * Download and decrypt inbound invoice from FIRS
   */
  async decryptInvoice(authContext: AuthContext, irn: string): Promise<any> {
    return executeDecryptInvoiceStep({
      authContext,
      irn,
      firsService: this.firsService,
    });
  }

  /**
   * Acknowledge receipt of an inbound invoice
   */
  async acknowledgeInvoiceReceipt(
    businessId: string,
    irn: string,
    message?: string,
  ): Promise<any> {
    try {
      const ackResult = await this.firsService.acknowledgeInvoiceReceipt(irn);

      const inboundInvoice = await this.inboundRepo.findByIRN(irn);
      if (inboundInvoice && inboundInvoice.businessId === businessId) {
        await this.inboundRepo.update(irn, {
          status: "ACKNOWLEDGED" as any,
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
      const { message: errMsg, code } = extractFIRSError(error);
      throw new AppError(code, `Acknowledgement failed: ${errMsg}`);
    }
  }

  /**
   * Update payment status of an invoice (PENDING, PAID, REJECTED)
   */
  async updateInvoiceStatus(
    tenantId: string,
    irn: string,
    status: InvoicePaymentStatusType,
    metadata?: {
      paymentDate?: Date;
      paymentAmount?: number;
      paymentReference?: string;
      rejectionReason?: string;
    },
  ): Promise<any> {
    return executeUpdateInvoiceStatusStep({
      tenantId,
      irn,
      status,
      metadata,
      outboundRepo: this.outboundRepo,
      inboundRepo: this.inboundRepo,
    });
  }

  /**
   * Report invoice to FIRS for VAT post-payment reporting
   */
  async reportInvoice(reportData: VATPostPaymentReportData): Promise<any> {
    return executeReportVATStep({
      reportData,
      firsService: this.firsService,
      outboundRepo: this.outboundRepo,
    });
  }

  /**
   * Confirm invoice status on FIRS
   */
  async confirmInvoiceStatus(businessId: string, irn: string): Promise<any> {
    return executeConfirmStatusStep({
      businessId,
      irn,
      firsService: this.firsService,
    });
  }
}

export * from "./steps";
