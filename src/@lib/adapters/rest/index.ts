
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

export const HandleErrorResponse = (error: any) => {
  const safeErrorState = error?.response?.data || error || [];
  const errorCap = safeErrorState?.message || safeErrorState[0]?.message || safeErrorState[0] || error;
  return errorCap;
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
        console.debug('Outgoing request:', {
          method: config.method,
          url: config.url,
          data: config.data
        });
        return config;
      },
      error => {
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

