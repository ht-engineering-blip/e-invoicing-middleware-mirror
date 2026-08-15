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
  code: string;
  value: string;
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

// Extend with other resources as needed (states, countries, currencies, paymentMeans, etc.)

