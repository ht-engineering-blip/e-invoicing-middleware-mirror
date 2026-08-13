import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import https from "node:https";
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
  constructor(apiKey?: string, apiSecret?: string) {
    const rejectUnauthorized = firsConfig?.rejectUnauthorized ?? false;
    super({
      baseURL: firsConfig?.baseUrl,
      timeout: firsConfig?.timeout,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "x-api-secret": apiSecret,
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized,
      }),
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
    let foundError = error?.response?.data?.error;
    console.log("Resp error:", { foundError, error });

    const errorMessage = foundError?.public_message
      ? `${foundError.public_message}${foundError.details ? ` - ${foundError.details}` : ""}`
      : HandleErrorResponse(error);

    const errorResp = new AppError(
      error?.response?.data?.code || error?.response?.status || 500,
      errorMessage,
      error,
    );

    return Promise.reject(errorResp);
  }

  public execute = async (
    path: string,
    payload: object,
    headers?: { Authorization?: string; verb?: string },
  ) => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    console.log(this.client.getUri());
    let response: AxiosResponse;
    if (headers && typeof headers === "object") {
      let verb: string = headers["verb"] || "post";
      response = await (this.client as any)[verb || "post"](normalizedPath, payload, {
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      });
    } else {
      response = await this.client.post(normalizedPath, payload);
    }
    return response.data;
  };

  public get = async <T>(
    path: string,
    config?: AxiosRequestConfig,
  ): Promise<T> => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    console.log(this.client.getUri(), normalizedPath);

    let response: AxiosResponse<T>;
    if (config?.headers?.Authorization) {
      response = await this.client.get<T>(normalizedPath, {
        ...config,
        headers: {
          "Content-Type": "application/json",
          ...config.headers,
        },
      });
    } else {
      response = await this.client.get<T>(normalizedPath, config);
    }
    return response.data;
  };
}

export class FIRSService {
  public appClient: FIRSClient;
  public siClient: FIRSClient;
  private inboundInvoiceRepository: InboundInvoiceRepository;
  constructor() {
    this.siClient = new FIRSClient(
      firsConfig?.siApiKey,
      firsConfig?.siApiSecret,
    );
    this.appClient = new FIRSClient(
      firsConfig?.appApiKey,
      firsConfig?.appApiSecret,
    );
    this.inboundInvoiceRepository = new InboundInvoiceRepository();
  }

  public async authenticate(credentials: { email: string; password: string }) {
    const response = await this.siClient.post<FIRSAuthResponse>(
      "/api/v1/utilities/authenticate",
      credentials,
    );

    console.log({ response });

    if (response.code !== 200) {
      throw new Error(
        `FIRS authentication failed with status: ${response.code}`,
      );
    }

    let authResponse = response.data;

    // Step 2: Get user information using the access token
    const userInfo = await this.getFIRSUserInfo(authResponse.entity_id);

    console.log({ userInfo });

    console.log(userInfo.code);

    if (userInfo) {
      const userData = userInfo.data || userInfo;
      const businesses: FIRSUserInfoBusiness[] = userData.businesses || [];
      const reference = userData.reference;

      let business = businesses.find(
        (b: FIRSUserInfoBusiness) =>
          b.id === reference || b.reference === reference,
      ) as FIRSUserInfoBusiness;

      if (!business && businesses.length > 0) {
        business = businesses[0];
      }

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
      const response = await this.appClient.get<FIRSUserInfo>(
        `/api/v1/entity/${entity_id}`,
      );

      if (response?.code && response.code !== 200) {
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

  public async validateInvoice(tenantId: string, invoice: any) {
    const client = this.appClient;
    return client.post<OkayResponse>("api/v1/invoice/validate", invoice);
  }

  public async searchInvoice(
    tenantId: string,
    business_id: string,
    irn: string,
  ) {
    const client = this.appClient;
    return client.get<{ data: SearchResponse }>(
      `api/v1/invoice/${business_id}`,
      {
        params: { irn },
      },
    );
  }

  public async signInvoice(tenantId: string, invoice: any) {
    const client = this.appClient;
    return client.post<OkayResponse>("api/v1/invoice/sign", invoice);
  }

  public async transmitInvoice(tenantId: string, irn: string) {
    const client = this.appClient;
    return client.post(`api/v1/invoice/transmit/${irn}`, {});
  }
  public async downloadInvoice(tenantId: string, irn: string) {
    const client = this.appClient;
    return client.get(`api/v1/invoice/download/${irn}`, {});
  }

  public async confirmSignedInvoice(tenantId: string, irn: string) {
    const client = this.appClient;
    return client.get<{ data: ConfirmResponse }>(
      `api/v1/invoice/confirm/${irn}`,
    );
  }

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

  public async acknowledgeInvoiceReceipt(tenantId: string, irn: string) {
    const client = this.appClient;
    return client.execute(
      `api/v1/invoice/transmit/${irn}`,
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
  public async reportVATPostPayment(
    tenantId: string,
    reportData: VATPostPaymentReportData,
  ) {
    const client = this.appClient;
    return client.post("api/v1/vat/postpayment", reportData);
  }

  /**
   * Update invoice payment status on FIRS
   * PATCH /api/v1/invoice/update/:irn
   */
  public async reportInvoice(
    tenantId: string,
    input: {
      irn: string;
      payment_status: "PENDING" | "PAID" | "CANCELED";
      reference?: string;
      [key: string]: any;
    },
  ) {
    const client = this.appClient;
    const { irn, payment_status, reference } = input;
    const body: Record<string, any> = { payment_status };
    if (reference !== undefined) body.reference = reference;
    return client.execute(`api/v1/invoice/update/${irn}`, body, {
      verb: "patch",
    });
  }

  /**
   * Fetch a reference resource list from FIRS
   * GET /api/v1/invoice/resources/:resourceName
   *
   * @param resourceName - The resource endpoint name (e.g. "payment-means", "tax-categories")
   */
  public async getResource<T>(resourceName: string): Promise<T[]> {
    const client = this.appClient;
    const response: any = await client.get(
      `api/v1/invoice/resources/${resourceName}`,
    );
    // FIRSClient.get() returns the AxiosResponse (via _handleResponse interceptor)
    // .data gives us the FIRS body { code: 200, data: [...] }
    // .data.data gives us the actual array
    const body = response?.data ?? response;
    return Array.isArray(body) ? body : (body?.data ?? body);
  }

  // Database operations
  public async saveInboundInvoiceToDB(invoice: any) {
    return this.inboundInvoiceRepository.create(invoice);
  }
}
