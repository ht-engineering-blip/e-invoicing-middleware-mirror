import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { decryptInvoice } from "firs-einvoicing";
import { AppError, HandleErrorResponse, RestClient } from "../rest";
import { generateQRCode } from "./generateQR";

import { firsConfig } from "../../../@config";
import { InboundInvoiceRepository } from "../../../v1/workflow/repos/inbound-invoice.repo";

export interface FIRSUserInfo {
  code: number;
  data: {
    id: string;
    reference: string;
    custom_settings: any;
    created_at: string;
    updated_at: string;
    businesses: FIRSUserInfoBusiness[];
    is_active: boolean;
    app_reference: string;
  };
}

export interface FIRSUserInfoBusiness {
  id: string;
  reference: string;
  name: string;
  custom_settings?: any;
  created_at: string;
  updated_at: string;
  tin: string;
  sector: string;
  annual_turnover: string;
  support_peppol: boolean;
  is_realtime_reporting: boolean;
  notification_channels: string;
  erp_system: string;
  irn_template: string;
  is_active: boolean;
}

export interface FIRSAuthResponse {
  code: number;
  data: {
    id: string;
    status: string;
    message: string;
    received_at: string;
    entity_id: string;
  };
}

/**
 * VAT Post-Payment Report Data Interface
 * Used for reporting invoices to FIRS for VAT post-payment
 */
export interface VATPostPaymentReportData {
  /** Accounting Supplier Party TIN */
  agent_tin: string;
  /** The line extension amount (amount to be taxed) */
  base_amount: string;
  /** Accounting Buyer Party TIN */
  beneficiary_tin: string;
  /** The document currency code (e.g., NGN) */
  currency: string;
  /** The item description within the invoice line */
  item_description: string;
  /** The Invoice Reference Number */
  irn: string;
  /** Summation of tax amount for each Tax category other than VAT */
  other_taxes: string;
  /** The payable amount (amount to be collected) */
  total_amount: string;
  /** Issue date (YYYY-MM-DD) */
  transaction_date: string;
  /** The Service ID of the Access Point Provider */
  integrator_service_id: string;
  /** Tax amount with tax category ID STANDARD_VAT, ZERO_VAT, or REDUCED_VAT */
  vat_calculated: string;
  /** Percentage attached to the tax category ID (e.g., "7.5") */
  vat_rate: string;
  /** The Tax (VAT) ID related to VAT type */
  vat_status: "STANDARD_VAT" | "ZERO_VAT" | "REDUCED_VAT";
}

export default class FIRSClient extends RestClient {
  constructor() {
    super({
      baseURL: firsConfig?.baseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": firsConfig?.apiKey,
        "x-api-secret": firsConfig?.apiSecret,
      },
    });
  }

  _handleResponse(_resp: AxiosResponse<any>) {
    let response: any = _resp;
    if (response.errors) {
      // console.log(response.errors,"errors");
      return Promise.reject(response.errors);
    }
    return response;
  }

  _handleError(error: AxiosError<any>) {
    // {
    //   status: error.response?.status,
    //   url: error.config?.url,
    //   message: error.message
    // }
    let foundError = error?.response?.data?.error;
    console.log("Resp error:", { foundError });
    const errorResp = new AppError(
      error?.response?.data?.code || error?.response?.status,
      foundError?.public_message + " - " + foundError?.details ||
        HandleErrorResponse(error),
      error,
    );

    return Promise.reject(errorResp);
  }

  public execute = (
    path: string,
    payload: object,
    headers?: { Authorization?: string; verb?: string },
  ) => {
    console.log(this.client.getUri());
    if (headers && typeof headers === "object") {
      let verb: string = headers["verb"] || "post";
      return (this.client as any)[verb || "post"](`${path}`, payload, {
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      });
    }
    return this.client.post(`/${path}`, payload);
  };

  public get = async <T>(
    path: string,
    config?: AxiosRequestConfig,
  ): Promise<T> => {
    console.log(this.client.getUri(), path);

    if (config?.headers?.Authorization) {
      return this.client.get(`${path}`, {
        ...config,
        headers: {
          "Content-Type": "application/json",
          ...config.headers,
        },
      });
    }
    return this.client.get(`/${path}`, config);
  };
}

export class FIRSService {
  private client: FIRSClient;
  private inboundInvoiceRepository: InboundInvoiceRepository;
  constructor(client?: FIRSClient) {
    this.client = client || new FIRSClient();
    this.inboundInvoiceRepository = new InboundInvoiceRepository();
  }

  public async authenticate(credentials: { email: string; password: string }) {
    const response = await this.client.post<FIRSAuthResponse>(
      "/api/v1/utilities/authenticate",
      credentials,
    );

    if (response.code !== 200) {
      throw new Error(
        `FIRS authentication failed with status: ${response.code}`,
      );
    }

    let authResponse = response.data;

    // Step 2: Get user information using the access token
    const userInfo: FIRSUserInfo = await this.getFIRSUserInfo(
      authResponse.entity_id,
    );

    if (userInfo) {
      let business = userInfo.data.businesses.find(
        (business: FIRSUserInfoBusiness) =>
          business.id === userInfo.data.reference,
      ) as FIRSUserInfoBusiness;

      return {
        data: business,
      };
    }
  }

  /**
   * Get user information from FIRS using access token
   */
  async getFIRSUserInfo(entity_id: string): Promise<FIRSUserInfo> {
    try {
      const response = await this.client.get<FIRSUserInfo>(
        `/api/v1/entity/${entity_id}`,
      );

      if (response.code !== 200) {
        throw new Error(
          `Failed to get FIRS user info with status: ${response.code}`,
        );
      }

      return response;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new Error("Invalid or expired FIRS access token");
        }
        throw new Error(
          `FIRS user info error: ${error.response?.data?.message || error.message}`,
        );
      }
      throw error;
    }
  }

  public async validateInvoice(invoice: any) {
    return this.client.post<OkayResponse>("api/v1/invoice/validate", invoice);
  }

  public async searchInvoice(business_id: string, irn: string) {
    return this.client.get<SearchResponse>(`api/v1/invoice/${business_id}`, {
      params: { irn },
    });
  }

  public async signInvoice(invoice: any) {
    return this.client.post<OkayResponse>("api/v1/invoice/sign", invoice);
  }

  public async transmitInvoice(irn: string) {
    return this.client.post(`api/v1/invoice/transmit/${irn}`, {});
  }
  public async downloadInvoice(irn: string) {
    return this.client.get(`api/v1/invoice/download/${irn}`, {});
  }

  public async confirmSignedInvoice(irn: string) {
    return this.client.get<{ data: ConfirmResponse }>(
      `api/v1/invoice/confirm/${irn}`,
    );
  }

  /*  public async generateQRCode(irn: any):  Promise<{ qrCode: string, data: string } | any> {
         try {
             const keys = {
                 public_key: PUB_KEY,
                 certificate: CERTIFICATE
             };
 
             const { encryptedData } = encryptIRNAndCertificate(
                 keys,
                 irn,
                 keys.certificate
             );
             // Generate QRcode
             let qrCode = await QRCode.toDataURL(encryptedData, {
                 type: "image/png",
                 size: 300,
                 fgColor: "#000000",
                 bgColor: "#00FFFFaa",
                 logo: "https://heirstechnologies.com/wp-content/uploads/2020/02/icon.png",
                 logoSizeRatio: 0.2,
             });
 
 
             return {
                 qrCode: qrCode as any,
                 data: encryptedData
             }
         } catch (error: any) {
             console.error("Encryption/Decryption failed:", error.message);
         }
 
     } */

  public async generateQRCodeV2(
    irn: any,
    businessCertificate: string,
    businessPublicKey: string,
  ): Promise<{ qrCode: string; data: string } | undefined> {
    try {
      const keys = {
        public_key: businessPublicKey,
        certificate: businessCertificate,
      };

      //const { encryptedData } = // Encrypt IRN and generate QR code
      const encryptionResult = await generateQRCode({
        // NOTE: You do not need to provide a timestamp manually. A timestamp is automatically generated at the time of processing.
        irn: irn,
        certificate: businessCertificate,
        publicKey: businessPublicKey,
        size: 300,
        fgColor: "#424242",
        bgColor: "#ffffff",
        //logo: "https://heirstechnologies.com/wp-content/uploads/2020/02/icon.png",
        logoSizeRatio: 0.07,
      });

      console.log(encryptionResult);

      return {
        qrCode: encryptionResult.qrCodeDataUrl,
        data: encryptionResult.encryptedBase64,
      };
    } catch (error: any) {
      console.error("Encryption/Decryption failed:", error.message);
    }
  }

  public async decryptInvoice(invoice: any) {
    try {
      return await decryptInvoice(invoice);
    } catch (error: any) {
      console.error("Decryption failed:", error.message);
    }
  }

  public async acknowledgeInvoiceReceipt(irn: string) {
    return this.client.execute(
      `invoice/transmit/${irn}`,
      {
        message: "ACKNOWLEDGED",
      },
      { verb: "patch" },
    );
  }

  /**
   * Report VAT Post-Payment to FIRS
   * POST /api/v1/vat/postpayment
   *
   * @param reportData - VAT post-payment report data (see VATPostPaymentReportData interface)
   */
  public async reportVATPostPayment(reportData: VATPostPaymentReportData) {
    return this.client.post("/api/v1/vat/postpayment", reportData);
  }

  /**
   * Update invoice payment status on FIRS
   * PATCH /api/v1/invoice/update/:irn
   */
  public async reportInvoice(input: {
    irn: string;
    payment_status: "PENDING" | "PAID" | "CANCELED";
    reference?: string;
    [key: string]: any;
  }) {
    const { irn, payment_status, reference } = input;
    const body: Record<string, any> = { payment_status };
    if (reference !== undefined) body.reference = reference;
    return this.client.execute(`api/v1/invoice/update/${irn}`, body, {
      verb: "patch",
    });
  }

  // Database operations
  public async saveInboundInvoiceToDB(invoice: any) {
    return this.inboundInvoiceRepository.create(invoice);
  }
}
