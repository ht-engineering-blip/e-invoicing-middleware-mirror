import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { extractFIRSError } from "../../../shared/utils";
import { TenantService } from "../../../tenants/services/tenant.service";
import { OutboundInvoiceSource, OutboundInvoiceStatus } from "../../models";
import { OutboundInvoiceRepository } from "../../repos/outbound-invoice.repo";
import {
  retryWithAutoFix,
  sanitizeInvoicePayload,
} from "../../utils/invoice-sanitizer.util";

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

    return {
      qrCode: encryptedData.qrCode,
      data: encryptedData.data,
    };
  }

  getFIRSError = (error: unknown) => extractFIRSError(error);

  /**
   * Orchestrates the outbound workflow for an invoice:
   *   1. Validate invoice against FIRS (ALWAYS executed)
   *   2. Sign invoice via FIRS
   *   3. Confirm signed status
   *   4. Generate QR code
   *   5. Transmit to FIRS portal (when transmit = true)
   */
  async handleOutboundWorkflow(
    rawInvoice: SecureInvoice,
    transmit: boolean = false,
  ) {
    // Sanitize & normalize invoice payload before executing outbound steps
    const invoice = sanitizeInvoicePayload(rawInvoice) as SecureInvoice;

    // Load persisted workflow state
    let stored = null;
    const tenantId = invoice.tenant_id || invoice.tenantId;
    const erpInvoiceId = invoice.invoice_id || invoice.erpInvoiceId;

    if (invoice.irn) {
      stored = await this.outboundRepo.findByIrn(invoice.irn).catch(() => null);
      if (!stored && tenantId) {
        stored = await this.outboundRepo
          .upsertByIrn({
            irn: invoice.irn,
            tenantId,
            source: OutboundInvoiceSource.API,
            erpInvoiceId,
            createdBy: tenantId,
            workflowState: {
              transformed: true,
              validated: false,
              signed: false,
              transmitted: false,
              delivered: false,
            },
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[OutboundService] upsertByIrn warning:", msg);
            return null;
          });
      }
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
              (invoice.data as Record<string, unknown>).business_id =
                firsCreds.clientId;
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
          console.log(`\n📡 [NRS Response: Search Invoice]`, {
            irn: invoice.irn,
            business_id: invoice.business_id,
            found: (searchedInvoice?.data?.data?.items?.length ?? 0) > 0,
            response: searchedInvoice?.data ?? searchedInvoice,
          });
          skipSigning = (searchedInvoice?.data?.data?.items?.length ?? 0) > 0;
        } catch (searchErr: unknown) {
          console.log(
            `\n📡 [NRS Response: Search Invoice] IRN ${invoice.irn} not found on server (proceeding with validation/signing)`,
          );
          skipSigning = false;
        }
      }

      // Step 1: Validate - ALWAYS call the validate endpoint from NRS cause that is what makes it confirmed all works
      let validatedInvoice: OkayResponse | undefined;

      try {
        validatedInvoice = await retryWithAutoFix(
          async (inv) => this.firsService.validateInvoice(inv),
          invoice,
          {
            maxRetries: 3,
            initialDelayMs: 500,
          },
        );
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`\n❌ [NRS Response: Validate Invoice Failed]`, errorMsg);
        throw error;
      }

      console.log(
        `\n📡 [NRS Response: Validate Invoice] (HTTP 200 OK)`,
        JSON.stringify(
          {
            endpoint: "/api/v1/invoice/validate",
            irn: invoice.irn,
            business_id: invoice.business_id,
            code: validatedInvoice?.code ?? 200,
            status: "VALIDATED",
            data: validatedInvoice?.data ?? validatedInvoice,
          },
          null,
          2,
        ),
      );

      if (
        !validatedInvoice ||
        (validatedInvoice.code !== 200 && !validatedInvoice?.data?.ok)
      ) {
        const { message } = extractFIRSError(validatedInvoice);
        throw new Error(`Invoice validation failed: ${message}`);
      }

      if (invoice.irn) {
        await this.outboundRepo.update(invoice.irn, {
          status: OutboundInvoiceStatus.VALIDATED,
        });

        await this.outboundRepo.updateWorkflowState(invoice.irn, {
          validated: true,
        });
      }
      wf.validated = true;

      // Step 2: Sign
      if (!skipSigning && !wf.signed) {
        let signedInvoice: OkayResponse | undefined;
        try {
          signedInvoice = await this.firsService.signInvoice(invoice);

          console.log(
            `\n📡 [NRS Response: Sign Invoice] (HTTP 200 OK)`,
            JSON.stringify(
              {
                endpoint: "/api/v1/invoice/sign",
                irn: invoice.irn,
                code: signedInvoice?.code ?? 200,
                status: "SIGNED",
                data: signedInvoice?.data ?? signedInvoice,
              },
              null,
              2,
            ),
          );

          if (signedInvoice.code !== 200 && !signedInvoice?.data?.ok) {
            const { message } = extractFIRSError(signedInvoice);
            throw new Error(`Invoice signing failed: ${message}`);
          }
        } catch (signErr: unknown) {
          const errMsg =
            signErr instanceof Error
              ? signErr.message.toLowerCase()
              : String(signErr).toLowerCase();
          if (
            errMsg.includes("duplicate request") ||
            errMsg.includes("already exist") ||
            errMsg.includes("already signed")
          ) {
            console.log(
              `\nℹ [Invoice Retry] Invoice '${invoice.irn}' is already signed in FIRS. Proceeding to confirmation, QR code generation, and transmission...`,
            );
          } else {
            throw signErr;
          }
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

          const confirmedMap = confirmedInvoice as Record<string, unknown>;
          const confirmedData = confirmedMap?.data as
            | Record<string, unknown>
            | undefined;

          console.log(
            `\n📡 [NRS Response: Confirm Signed Invoice] (HTTP 200 OK)`,
            JSON.stringify(
              {
                endpoint: `/api/v1/invoice/confirm/${invoice.irn}`,
                irn: invoice.irn,
                code: confirmedMap?.code ?? confirmedData?.code ?? 200,
                status: "CONFIRMED",
                data: confirmedInvoice?.data ?? confirmedInvoice,
              },
              null,
              2,
            ),
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
        } catch (confirmError: unknown) {
          const confirmMsg =
            confirmError instanceof Error
              ? confirmError.message
              : String(confirmError);
          console.warn(
            "[OutboundService] Confirmation check failed (tolerated):",
            confirmMsg,
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

        console.log(`\n📡 [NRS Response: Generate QR Code]`, {
          irn: invoice.irn,
          hasQrCode: !!encryptedData?.qrCode,
          qrCodeLength: encryptedData?.qrCode?.length,
          qrCodePreview: encryptedData?.qrCode
            ? `${encryptedData.qrCode.slice(0, 60)}...`
            : undefined,
          encryptedDataSummary: encryptedData?.data
            ? `${encryptedData.data.slice(0, 40)}...`
            : undefined,
        });

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
      } catch (qrError: unknown) {
        const qrMsg =
          qrError instanceof Error ? qrError.message : String(qrError);
        console.warn(
          "[OutboundService] QR generation warning (tolerated):",
          qrMsg,
        );
      }

      // Step 5: Transmit
      let transmissionFailed = false;
      if (transmit && (toTransmit || !wf.transmitted)) {
        try {
          const transmitRes = await this.firsService.transmitInvoice(
            invoice.irn,
          );

          console.log(
            `\n📡 [NRS Response: Transmit Invoice] (HTTP 200 OK)`,
            JSON.stringify(
              {
                endpoint: `/api/v1/invoice/transmit/${invoice.irn}`,
                irn: invoice.irn,
                code: transmitRes?.code ?? 200,
                status: "TRANSMITTED",
                data: transmitRes?.data ?? transmitRes,
              },
              null,
              2,
            ),
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
          const transmitErrorMsg =
            transmitError instanceof Error
              ? transmitError.message
              : String(transmitError);
          console.warn(
            "TRANSMISSION WARNING (tolerated — invoice is signed & confirmed):",
            transmitError,
          );
          transmissionFailed = true;
          wf.transmitted = false;
          wf.delivered = true;
          await this.outboundRepo.update(invoice.irn, {
            status: OutboundInvoiceStatus.DELIVERED,
            metadata: {
              ...stored?.metadata,
              transmissionError: transmitErrorMsg,
              workflowState: wf,
            },
          });
          await this.outboundRepo.updateWorkflowState(invoice.irn, {
            transmitted: false,
            delivered: true,
          });
          await this.outboundRepo.setLastJobError(
            invoice.irn,
            "transmit",
            transmitErrorMsg,
          );
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
    } catch (error: unknown) {
      console.error("OUTBOUND WORKFLOW STEP FAILED", { error });
      throw error;
    }
  }
}
