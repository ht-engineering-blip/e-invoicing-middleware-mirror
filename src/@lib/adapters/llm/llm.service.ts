import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { AppError, HandleErrorResponse, RestClient } from "../rest";
import { InboundInvoiceRepository } from "../../../v1/workflow/repos/inbound-invoice.repo";
import { aiConfig, firsConfig } from "../../../@config";
import {
  DICTIONARY_PROMPT,
  MAPPING_RULES_PROMPT,
  formatSchemaFields,
} from "./prompts";
import { ISchemaField } from "../../../v1/workflow/models";
import { cleanAndParseJson } from "../../utils";

export interface FIRSUserInfo {
  id: string;
  reference: string;
  custom_settings: any;
  created_at: string;
  updated_at: string;
  businesses: FIRSUserInfoBusiness[];
  is_active: boolean;
  app_reference: string;
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

export default class LLMClient extends RestClient {
  constructor() {
    super({
      baseURL: aiConfig?.apiEndpoint!,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig?.apiKey}`,
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
    // Redact Authorization header to prevent token leakage in AxiosError objects or logs
    if (error.config?.headers) {
      const headers = error.config.headers as any;
      if (headers.Authorization) headers.Authorization = "[REDACTED]";
      if (headers.authorization) headers.authorization = "[REDACTED]";
    }
    if (error.request?._headers) {
      const requestHeaders = error.request._headers as any;
      if (requestHeaders.Authorization)
        requestHeaders.Authorization = "[REDACTED]";
      if (requestHeaders.authorization)
        requestHeaders.authorization = "[REDACTED]";
    }

    let foundError = error?.response?.data?.error;
    console.log("Resp error:", { foundError });
    const errorResp = new AppError(
      error?.response?.data?.code || error?.response?.status,
      foundError?.public_message || HandleErrorResponse(error),
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

export class LLMService {
  private client: LLMClient;
  private inboundInvoiceRepository: InboundInvoiceRepository;
  constructor(client?: LLMClient) {
    this.client = client || new LLMClient();
    this.inboundInvoiceRepository = new InboundInvoiceRepository();
  }

  /**
   * Generate Invoice Dictionary
   */
  async generateInvoiceDictionary(
    erp: any,
    invoice: any,
    metadata: any = {},
  ): Promise<any> {
    try {
      let payload = {
        model: aiConfig?.model,
        messages: [
          {
            role: "system",
            content: DICTIONARY_PROMPT(erp, invoice, "JSON"),
          },
          {
            role: "user",
            content: `Using the provided payload and erp, extract the dictionary as specified to help us with mapping to external systems.
                        METADATA:
                        ${JSON.stringify(metadata)}

                        KEY and Data Types"
                        ${JSON.stringify(metadata.dataTypes)}

                        `,
          },
        ],
      };
      const response: any = await this.client.post(``, payload);
      if (!response.choices) {
        throw new Error(`Failed to extract invoice dictionary`);
      }
      const content = response.choices[0].message.content;
      return JSON.parse(content);
    } catch (error: any) {
      // Securely redact Authorization headers in error objects to prevent key leakage in logs
      if (error?.errors?.config?.headers) {
        const headers = error.errors.config.headers;
        if (headers.Authorization) headers.Authorization = "[REDACTED]";
        if (headers.authorization) headers.authorization = "[REDACTED]";
      }
      if (axios.isAxiosError(error)) {
        if (error.config?.headers) {
          const headers = error.config.headers as any;
          if (headers.Authorization) headers.Authorization = "[REDACTED]";
          if (headers.authorization) headers.authorization = "[REDACTED]";
        }
        if (error.response?.status === 401) {
          throw new Error("Invalid or expired LLM access token");
        }
        throw new Error(
          `Dictionary extraction error: ${error.response?.data?.message || error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Generate Deterministic Mapping Rules (source ERP -> FIRS UBL)
   */
  async generateMappingRules(
    erp: string,
    sampleInvoice: any,
    firsSchemaFields?: ISchemaField[],
  ): Promise<Array<{ source: string; target: string }>> {
    try {
      const firsSchemaText = firsSchemaFields
        ? formatSchemaFields(firsSchemaFields, "FIRS UBL")
        : undefined;

      const promptContent = MAPPING_RULES_PROMPT(
        erp,
        sampleInvoice,
        firsSchemaText,
      );

      const isGemini = aiConfig?.provider === "gemini";

      if (isGemini) {
        const model = aiConfig?.model || "gemini-2.0-flash";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiConfig?.apiKey}`;
        const body = {
          contents: [{ role: "user", parts: [{ text: promptContent }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        };
        const geminiRes = await axios.post(url, body, {
          headers: { "Content-Type": "application/json" },
        });
        const candidate = geminiRes.data?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text || "";
        const parsed = cleanAndParseJson(text);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (rule: any) =>
              rule &&
              typeof rule.source === "string" &&
              rule.source.trim() !== "" &&
              typeof rule.target === "string" &&
              rule.target.trim() !== "",
          );
        }
        return [];
      }

      const payload = {
        model: aiConfig?.model || "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: promptContent,
          },
        ],
        temperature: 0.1,
      };

      const response: any = await this.client.post(``, payload);
      if (!response.choices || !response.choices[0]?.message?.content) {
        throw new Error("Failed to generate mapping rules from LLM");
      }
      const rawContent = response.choices[0].message.content;
      const parsed = cleanAndParseJson(rawContent);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (rule: any) =>
            rule &&
            typeof rule.source === "string" &&
            rule.source.trim() !== "" &&
            typeof rule.target === "string" &&
            rule.target.trim() !== "",
        );
      }
      return [];
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new Error("Invalid or expired LLM access token");
        }
        throw new Error(
          `Mapping rules generation error: ${error.response?.data?.message || error.message}`,
        );
      }
      throw error;
    }
  }
}
