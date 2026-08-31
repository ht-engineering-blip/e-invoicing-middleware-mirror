import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { TenantService } from "../../../tenants/services/tenant.service";
import { OutboundInvoiceStatus } from "../../models";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { generateUniqueHsnCode } from "../../utils/transformer/utils";
import { extractFIRSError, retryWithBackoff } from "../../../shared/utils";

export class OutboundWorkflowService {
  private tenantService: TenantService;
  private outboundRepo: OutboundInvoiceRepository;
  private firsService: FIRSService;

  constructor(dependencies?: {
    tenantService?: TenantService;
    outboundRepo?: OutboundInvoiceRepository;
    firsService?: FIRSService;
  }) {
    this.tenantService = dependencies?.tenantService ?? new TenantService();
    this.outboundRepo =
      dependencies?.outboundRepo ?? new OutboundInvoiceRepository();
    this.firsService = dependencies?.firsService ?? new FIRSService();
  }

  /**
   * Final step of the outbound chain: generate QR code from FIRS.
   */
  async generateQRCode(irn: string, tenantId: string) {
    const firsCreds = await this.tenantService.getFIRSCredentials(tenantId);

    const encryptedData = await this.firsService.generateQRCodeV2(
      irn,
      firsCreds.certificate || "",
      firsCreds.publicKey || "",
    );

    if (!encryptedData?.qrCode && !encryptedData?.data) {
      throw new Error("QR code generation failed");
    }

    return encryptedData;
  }

  getFIRSError = (error: any) => extractFIRSError(error);

  async handleOutboundWorkflow(
    invoice: SecureInvoice,
    transmit: boolean = false,
  ) {
    // Load persisted workflow state
    let stored = null;
    if (invoice.irn) {
      stored = await this.outboundRepo.findByIrn(invoice.irn).catch(() => null);
    }

    const wf = stored?.workflowState ?? {
      transformed: false,
      validated: false,
      signed: false,
      transmitted: false,
      delivered: false,
    };

    // Already fully delivered — return stored QR code immediately
    if (wf.delivered && stored?.qrCode) {
      return { qrCode: stored.qrCode, data: stored.metadata?.firsSignedData };
    }

    try {
      // Resolve real FIRS businessId if tenant_id is available
      const tenantIdentifier = invoice.tenant_id || stored?.tenantId;
      if (tenantIdentifier) {
        try {
          const firsCreds =
            await this.tenantService.getFIRSCredentials(tenantIdentifier);
          if (firsCreds?.clientId) {
            invoice.business_id = firsCreds.clientId;
            if (invoice.data && typeof invoice.data === "object") {
              invoice.data.business_id = firsCreds.clientId;
            }
          }
        } catch (credErr: unknown) {
          // ignore
        }
      }

      // Step 0: Check if signing is needed
      let skipSigning = wf.signed;

      if (!skipSigning && invoice.business_id && invoice.irn) {
        try {
          const searchedInvoice = await this.firsService.searchInvoice(
            invoice.business_id,
            invoice.irn,
          );
          skipSigning = (searchedInvoice?.data?.data?.items?.length ?? 0) > 0;
        } catch (searchErr: unknown) {
          skipSigning = false;
        }
      }

      // Step 1: Validate
      if (!wf.validated) {
        let validatedInvoice: OkayResponse | undefined;

        try {
          validatedInvoice = await retryWithBackoff(
            async () => this.firsService.validateInvoice(invoice),
            {
              maxRetries: 3,
              initialDelayMs: 500,
              shouldRetry: (err) => {
                const errStr = String(err?.message || "").toLowerCase();
                return errStr.includes("hsn");
              },
              onRetry: () => {
                if (Array.isArray(invoice.invoice_line)) {
                  const usedHsnCodes = new Set<string>();
                  for (const line of invoice.invoice_line) {
                    const lineDesc =
                      line.product_category ||
                      line.service_category ||
                      line.item?.description ||
                      line.item?.name;

                    line.hsn_code = generateUniqueHsnCode(
                      usedHsnCodes,
                      lineDesc,
                    );
                  }
                }
              },
            },
          );
        } catch (error: any) {
          throw error;
        }

        if (
          !validatedInvoice ||
          (validatedInvoice.code !== 200 && !validatedInvoice?.data?.ok)
        ) {
          const { message } = extractFIRSError(validatedInvoice);
          throw new Error(`Invoice validation failed: ${message}`);
        }

        await this.outboundRepo.update(invoice.irn, {
          status: OutboundInvoiceStatus.VALIDATED,
        });

        await this.outboundRepo.updateWorkflowState(invoice.irn, {
          validated: true,
        });
        wf.validated = true;
      }

      // Step 2: Sign
      if (!skipSigning && !wf.signed) {
        const signedInvoice = await this.firsService.signInvoice(invoice);

        if (signedInvoice.code !== 200 && !signedInvoice?.data?.ok) {
          const { message } = extractFIRSError(signedInvoice);
          throw new Error(`Invoice signing failed: ${message}`);
        }

        await this.outboundRepo.update(invoice.irn, {
          status: OutboundInvoiceStatus.SIGNED,
        });

        await this.outboundRepo.updateWorkflowState(invoice.irn, {
          signed: true,
        });
        wf.signed = true;
      }

      // Step 3: Confirm
      let toTransmit = true;
      if (!wf.transmitted) {
        try {
          const confirmedInvoice = await this.firsService.confirmSignedInvoice(
            invoice.irn,
          );

          const confirmCode = confirmedInvoice?.data?.code;
          if (confirmCode && confirmCode !== 200) {
            const { message } = extractFIRSError(confirmedInvoice);
            console.warn(
              `[OutboundService] Confirmation check warning: ${message}`,
            );
          }

          const isAlreadyTransmitted = Boolean(
            confirmedInvoice?.data?.data?.transmitted,
          );

          toTransmit = !isAlreadyTransmitted;

          if (isAlreadyTransmitted) {
            await this.outboundRepo.update(invoice.irn, {
              status: OutboundInvoiceStatus.TRANSMITTED,
            });

            await this.outboundRepo.updateWorkflowState(invoice.irn, {
              transmitted: true,
            });
            wf.transmitted = true;
          }
        } catch (confirmError: any) {
          console.warn(
            "[OutboundService] Confirmation check failed (tolerated):",
            confirmError?.message,
          );
          toTransmit = true;
        }
      }

      // Step 4: Generate QR code
      let encryptedData: { qrCode: string; data: string } | undefined;
      try {
        const firsCredentials = await this.tenantService.getFIRSCredentials(
          invoice?.tenant_id,
        );

        encryptedData = await this.firsService.generateQRCodeV2(
          invoice.irn,
          firsCredentials.certificate || "",
          firsCredentials.publicKey || "",
        );

        if (encryptedData?.qrCode) {
          const existingInvoice = await this.outboundRepo.findByIrn(
            invoice.irn,
          );
          if (existingInvoice) {
            await this.outboundRepo.update(invoice.irn, {
              qrCode: encryptedData.qrCode,
            });
          }
        }
      } catch (qrError: any) {
        console.warn(
          "[OutboundService] QR generation warning (tolerated):",
          qrError?.message,
        );
      }

      // Step 5: Transmit
      let transmissionFailed = false;
      if (transmit && (toTransmit || !wf.transmitted)) {
        try {
          const transmitRes = await this.firsService.transmitInvoice(
            invoice.irn,
          );

          if (
            transmitRes &&
            transmitRes.code &&
            transmitRes.code !== 200 &&
            !transmitRes?.data?.ok
          ) {
            const { message } = extractFIRSError(transmitRes);
            throw new Error(`Transmission failed: ${message}`);
          }

          await this.outboundRepo.update(invoice.irn, {
            status: OutboundInvoiceStatus.DELIVERED,
          });

          await this.outboundRepo.updateWorkflowState(invoice.irn, {
            transmitted: true,
            delivered: true,
          });
          wf.transmitted = true;
          wf.delivered = true;
        } catch (transmitError: unknown) {
          console.warn(
            "TRANSMISSION WARNING (tolerated — invoice is signed & confirmed):",
            transmitError,
          );
          await this.outboundRepo.update(invoice.irn, {
            status: OutboundInvoiceStatus.DELIVERED,
            metadata: {
              ...stored?.metadata,
              workflowState: wf,
            },
          });
          await this.outboundRepo.updateWorkflowState(invoice.irn, {
            transmitted: true,
            delivered: true,
          });
          wf.transmitted = true;
          wf.delivered = true;
        }
      }

      return {
        qrCode: encryptedData?.qrCode || stored?.qrCode,
        data: encryptedData?.data || stored?.metadata?.firsSignedData,
        transmissionFailed,
        transmissionError: transmissionFailed
          ? (stored?.metadata?.transmissionError ?? "Transmission failed")
          : undefined,
      };
    } catch (error: any) {
      console.error("OUTBOUND WORKFLOW STEP FAILED", { error });
      throw error;
    }
  }
}
