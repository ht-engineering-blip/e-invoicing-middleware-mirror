
import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosHeaders, AxiosResponse, AxiosError } from 'axios';

export class AppError extends Error {
  public statusCode: number;
  public message: string;
  public errors?: Array<{ field?: string; message: string }>;
  constructor(
    statusCode: number,
    message: string,
    errors?: Array<{ field?: string; message: string }> | any
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.message = message;
    this.errors = errors;
  }
}

export const HandleErrorResponse = (error: any): string => {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;

  const data = error?.response?.data || error?.data || error;
  if (typeof data === "string") return data;

  if (data?.error) {
    if (typeof data.error === "string") return data.error;
    if (data.error.public_message) {
      return `${data.error.public_message}${data.error.details ? ` (${typeof data.error.details === "string" ? data.error.details : JSON.stringify(data.error.details)})` : ""}`;
    }
    if (data.error.message) return data.error.message;
  }

  if (data?.public_message) {
    return `${data.public_message}${data.details ? ` (${typeof data.details === "string" ? data.details : JSON.stringify(data.details)})` : ""}`;
  }

  if (data?.message) return data.message;
  if (data?.detail) return data.detail;
  if (data?.details) {
    return typeof data.details === "string" ? data.details : JSON.stringify(data.details);
  }

  if (Array.isArray(data?.errors)) {
    return data.errors
      .map((e: any) =>
        typeof e === "string"
          ? e
          : e?.message || (e?.field ? `${e.field}: ${e.message}` : JSON.stringify(e)),
      )
      .join("; ");
  }

  if (data?.errors && typeof data.errors === "object") {
    return JSON.stringify(data.errors);
  }

  if (error?.message && !error.message.includes("status code")) {
    return error.message;
  }

  const status = error?.response?.status || error?.statusCode;
  if (status) {
    return `HTTP ${status}: ${typeof data === "object" ? JSON.stringify(data) : data}`;
  }

  return error?.message || "An unexpected error occurred";
};

export abstract class RestClient {
  protected readonly client: AxiosInstance;

  constructor(option: AxiosRequestConfig) {
    this.client = axios.create({
      baseURL: process.env.CORE_API_URL,
      // timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      },
      ...option
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      config => {
        console.debug('Outgoing request:', JSON.stringify({
          method: config.method,
          url: config.url,
          data: config.data
        }, null, 2));
        return config;
      },
      error => {
        console.log(error, "error");

        let foundError = error.errors ? error.errors.toJSON() : error
        console.error('Request error:', { foundError });
        return Promise.reject(foundError);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      this._handleResponse,
      this._handleError
    );
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  async patch<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.patch<T>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }

  abstract _handleResponse({ data }: AxiosResponse): any;
  abstract _handleError(error: AxiosError): any;
}

