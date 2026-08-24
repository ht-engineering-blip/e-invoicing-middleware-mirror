import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { TenantService } from "../../../tenants/services/tenant.service";
import { OutboundInvoiceStatus } from "../../models";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import { generateUniqueHsnCode } from "../../utils/transformer/utils";

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
  async generateQRCode(irn: string, tenat: string) {
    const firsService = new FIRSService();
    const firsCreds = await this.tenantService.getFIRSCredentials(tenat);

    const encryptedData = await firsService.generateQRCodeV2(
      irn,
      firsCreds.certificate,
      firsCreds.publicKey,
    );

    if (!encryptedData?.qrCode && !encryptedData?.data) {
      throw new Error("QR code generation failed");
    }

    return encryptedData;
  }

  getFIRSError(error: any) {
    const data =
      error?.response?.data ||
      error?.data ||
      error?.errors?.response ||
      error?.errors;
    const message =
      data?.error?.public_message ||
      data?.error?.message ||
      data?.public_message ||
      data?.message ||
      (Array.isArray(data?.errors)
        ? data.errors
            .map((e: any) =>
              typeof e === "string" ? e : e?.message || JSON.stringify(e),
            )
            .join("; ")
        : data?.errors
          ? JSON.stringify(data.errors)
          : "") ||
      error?.message ||
      "An error occurred, please try again.";
    const code =
      error?.response?.status ||
      data?.code ||
      error?.statusCode ||
      error?.errors?.code ||
      500;
    return { message, code };
  }

  async handleOutboundWorkflow(
    invoice: SecureInvoice,
    transmit: boolean = false,
  ) {
    const firsService = new FIRSService();

    // Load persisted workflow state so we can resume from the last success point
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

    // Already fully delivered — return the stored QR code immediately
    if (wf.delivered && stored?.qrCode) {
      return { qrCode: stored.qrCode, data: stored.metadata?.firsSignedData };
    }

    try {
      // Step 0: Determine whether signing is needed.
      // If validated or signed already, skip the FIRS search (state is known).
      let skipSigning = wf.signed;

      if (!skipSigning) {
        const searchedInvoice = await firsService.searchInvoice(
          invoice.business_id,
          invoice.irn,
        );

        skipSigning = (searchedInvoice?.data?.data?.items?.length ?? 0) > 0;
      }

      // Step 1: Validate
      if (!wf.validated) {
        let validatedInvoice: OkayResponse | undefined;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
          try {
            validatedInvoice = await firsService.validateInvoice(invoice);
            break;
          } catch (error: any) {
            attempts++;
            const errorStr = String(error?.message || "").toLowerCase();

            if (errorStr.includes("hsn") && attempts < maxAttempts) {
              console.log(
                `[OutboundService] Caught HSN code error from FIRS. Regenerating HSN codes and retrying (Attempt ${attempts + 1}/${maxAttempts})...`,
              );

              if (Array.isArray(invoice.invoice_line)) {
                const usedHsnCodes = new Set<string>();
                for (const line of invoice.invoice_line) {
                  // Use product_category or service_category or item description for smart WCO HSN lookup
                  const lineDesc =
                    line.product_category ||
                    line.service_category ||
                    line.item?.description ||
                    line.item?.name;

                  line.hsn_code = generateUniqueHsnCode(usedHsnCodes, lineDesc);
                }
              }
              // Wait 1 second before retrying
              await new Promise((res) => setTimeout(res, 1000));
              continue;
            }
            // If it's a different error or we exceeded max attempts, throw
            throw error;
          }
        }

        if (
          !validatedInvoice ||
          (validatedInvoice.code !== 200 && !validatedInvoice?.data?.ok)
        ) {
          const { message } = this.getFIRSError(validatedInvoice);
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

      // Step 2: Sign (skip if already signed, or if FIRS already has the invoice)
      if (!skipSigning && !wf.signed) {
        const signedInvoice = await firsService.signInvoice(invoice);

        if (signedInvoice.code !== 200 && !signedInvoice?.data?.ok) {
          const { message } = this.getFIRSError(signedInvoice);
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
      let toTransmit = false;
      if (!wf.transmitted) {
        const confirmedInvoice = await firsService.confirmSignedInvoice(
          invoice.irn,
        );

        const confirmCode = confirmedInvoice?.data?.code;

        if (confirmCode && confirmCode !== 200) {
          const { message } = this.getFIRSError(confirmedInvoice);
          throw new Error(`Invoice confirmation failed: ${message}`);
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
      }

      // Step 4: Generate QR code
      const firsCredentials = await this.tenantService.getFIRSCredentials(
        invoice?.tenant_id,
      );

      const encryptedData = await firsService.generateQRCodeV2(
        invoice.irn,
        firsCredentials.certificate,
        firsCredentials.publicKey,
      );

      if (!encryptedData?.qrCode && !encryptedData?.data) {
        throw new Error(
          "QR code generation failed: FIRS encryption returned empty QR code and data",
        );
      }

      // Update stored invoice if exists
      const existingInvoice = await this.outboundRepo.findByIrn(invoice.irn);

      if (existingInvoice) {
        await this.outboundRepo.update(invoice.irn, {
          qrCode: encryptedData.qrCode,
        });
      }

      console.log("[Job:complete-outbound] Transmition Started", { invoice });

      // Step 5: Transmit
      let transmissionFailed = false;
      if (transmit && (toTransmit || !wf.transmitted)) {
        try {
          const transmitRes = await firsService.transmitInvoice(invoice.irn);

          console.log("TRENSMITTED RES", { transmitRes });

          if (
            transmitRes &&
            transmitRes.code &&
            transmitRes.code !== 200 &&
            !transmitRes?.data?.ok
          ) {
            const { message } = this.getFIRSError(transmitRes);
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
        } catch (transmitError: any) {
          console.error("TRANSMISSION FAILED (tolerated)", { transmitError });
          transmissionFailed = true;

          await this.outboundRepo.update(invoice.irn, {
            status: OutboundInvoiceStatus.TRANSMISTION_FAILED,
            metadata: {
              ...stored?.metadata,
              workflowState: wf,
              transmissionError: transmitError.message || String(transmitError),
            },
          });
          await this.outboundRepo.updateWorkflowState(invoice.irn, {
            delivered: true,
          });
          wf.delivered = true;
        }
      }

      return {
        qrCode: encryptedData.qrCode,
        data: encryptedData.data,
        transmissionFailed,
      };
    } catch (error: any) {
      console.error("OUTBOUND WORKFLOW STEP FAILED", { error });
      throw error;
    }
  }
}
