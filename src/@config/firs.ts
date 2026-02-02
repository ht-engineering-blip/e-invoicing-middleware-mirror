import { z } from 'zod';
import { handleConfigError } from './errors';

const firsConfigSchema = z.object({
  baseUrl: z.url().default('https://api.firs.gov.ng'),
  apiKey: z.string(),
  apiSecret: z.string(),
  timeout: z.coerce.number().int().positive().default(30000),
  retryAttempts: z.number().int().nonnegative().default(3),
  retryDelay: z.number().int().nonnegative().default(1000),
});

const parseFirsConfig = () => {
  try {
    return firsConfigSchema.parse({
      baseUrl: process.env.FIRS_BASE_URL,
      apiKey: process.env.FIRS_API_KEY,
      apiSecret: process.env.FIRS_API_SECRET,
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
