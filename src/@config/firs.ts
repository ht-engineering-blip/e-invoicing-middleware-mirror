import { z } from 'zod';
import { handleConfigError } from './errors';

const firsConfigSchema = z.object({
  baseUrl: z.url().default('https://api.firs.gov.ng'),
  siApiKey: z.string().optional(),
  siApiSecret: z.string().optional(),
  appApiKey: z.string().optional(),
  appApiSecret: z.string().optional(),
  rejectUnauthorized: z.boolean().default(true),
  mockCertificate: z
    .string()
    .default(
      "-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuMOCK_FIRS_CERTIFICATE_PEM\n-----END CERTIFICATE-----",
    ),
  mockPublicKey: z
    .string()
    .default(
      "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuMOCK_FIRS_PUBLIC_KEY_PEM\n-----END PUBLIC KEY-----",
    ),

  timeout: z.coerce.number().int().positive().default(30000),
  retryAttempts: z.number().int().nonnegative().default(3),
  retryDelay: z.number().int().nonnegative().default(1000),
});

const parseFirsConfig = () => {
  try {
    return firsConfigSchema.parse({
      baseUrl: process.env.FIRS_BASE_URL,
      siApiKey: process.env.FIRS_SI_API_KEY,
      siApiSecret: process.env.FIRS_SI_API_SECRET,
      appApiKey: process.env.FIRS_APP_API_KEY,
      appApiSecret: process.env.FIRS_APP_API_SECRET,
      rejectUnauthorized: process.env.FIRS_REJECT_UNAUTHORIZED !== 'false',
      mockCertificate: process.env.FIRS_MOCK_CERTIFICATE,
      mockPublicKey: process.env.FIRS_MOCK_PUBLIC_KEY,

      timeout: process.env.FIRS_TIMEOUT,
      retryAttempts: process.env.FIRS_RETRY_ATTEMPTS
        ? Number(process.env.FIRS_RETRY_ATTEMPTS)
        : undefined,
      retryDelay: process.env.FIRS_RETRY_DELAY
        ? Number(process.env.FIRS_RETRY_DELAY)
        : undefined,
    });
  } catch (error) {
    handleConfigError('firs', error);
  }
};

export const firsConfig = parseFirsConfig();
