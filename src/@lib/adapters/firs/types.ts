// src/@lib/adapters/firs/types.ts

/**
 * Interfaces for FIRS lookup resource arrays.
 */
export interface TaxCategory {
  code: string;
  value: string;
  percent: number;
}

export interface InvoiceType {
  key?: string;
  code?: string;
  value: string;
  description?: string;
}

export interface HsCode {
  code: string;
  label: string;
  keywords: string[];
}

export interface QuantityCode {
  code: string;
  value: string;
}

export interface ServiceCode {
  code: string;
  value: string;
}

export interface Lga {
  code: string;
  name: string;
  stateCode: string;
}

/**
 * FIRS Inbound Download and Decryption types
 */
export interface FIRSDownloadedInvoiceData {
  iv_hex: string;
  pub: string;
  data: string;
}

export interface FIRSDownloadInvoiceResponse {
  code: number;
  data: FIRSDownloadedInvoiceData;
}

export interface FIRSDecryptInvoiceInput {
  iv_hex: string;
  pub: string;
  ciphertext: string;
  api_key?: string;
}

export interface Currency {
  symbol: string;
  name: string;
  symbol_native: string;
  decimal_digits: number;
  rounding: number;
  code: string;
  name_plural: string;
}

// Extend with other resources as needed (states, countries, paymentMeans, etc.)

