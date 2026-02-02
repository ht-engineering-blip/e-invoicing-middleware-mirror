import axios, { type AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { AppError, HandleErrorResponse, RestClient } from "../rest";
import { InboundInvoiceRepository } from "../../../v1/workflow/repos/inbound-invoice.repo";
import { aiConfig, firsConfig } from "../../../@config";
import { DICTIONARY_PROMPT } from "./prompts";
import { cleanAndParseJson } from "../../utils";


export interface FIRSUserInfo {
    id: string
    reference: string
    custom_settings: any
    created_at: string
    updated_at: string
    businesses: FIRSUserInfoBusiness[]
    is_active: boolean
    app_reference: string
}

export interface FIRSUserInfoBusiness {
    id: string
    reference: string
    name: string
    custom_settings?: any
    created_at: string
    updated_at: string
    tin: string
    sector: string
    annual_turnover: string
    support_peppol: boolean
    is_realtime_reporting: boolean
    notification_channels: string
    erp_system: string
    irn_template: string
    is_active: boolean
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
            baseURL: aiConfig?.openApiEndpoint!,
            headers: {
                "Content-Type": "application/json",
                'Authorization': `Bearer ${aiConfig?.openAIApiKey}`
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
        let foundError = error?.response?.data?.error
        console.log('Resp error:', { foundError });
        const errorResp = new AppError(error?.response?.data?.code || error?.response?.status, foundError?.public_message || HandleErrorResponse(error), error)

        return Promise.reject(errorResp);
    }

    public execute = (
        path: string,
        payload: object,
        headers?: { Authorization?: string, verb?: string }
    ) => {
        console.log(this.client.getUri())
        if (headers && typeof headers === 'object') {
            let verb: string = headers["verb"] || 'post'
            return (this.client as any)[verb || 'post'](`${path}`, payload, {
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
        config?: AxiosRequestConfig
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
    async generateInvoiceDictionary(erp: any, invoice: any, metadata:any={}): Promise<any> {
        try {
            let payload = {
                model: aiConfig?.inferenceModel,
                messages: [
                    {
                        role: 'system',
                        content: DICTIONARY_PROMPT(erp, invoice, "JSON")
                    },
                    {
                        role: 'user',
                        content: `Using the provided payload and erp, extract the dictionary as specified to help us with mapping to external systems.
                        METADATA:
                        ${JSON.stringify(metadata)}

                        KEY and Data Types"
                        ${JSON.stringify(metadata.dataTypes)}

                        `
                    }
                ]
            }
            const response: any = await this.client.post(``, payload);
            console.log(response)
            if (!response.choices) {

                throw new Error(`Failed to extract invoice dictionary`);
            }
            const content = response.choices[0].message.content; 
            return JSON.parse(content);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 401) {
                    throw new Error('Invalid or expired LLM access token');
                }
                throw new Error(`Dictionary extraction error: ${error.response?.data?.message || error.message}`);
            }
            throw error;
        }
    }

}