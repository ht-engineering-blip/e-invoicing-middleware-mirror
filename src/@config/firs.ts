import { z } from 'zod';
import { handleConfigError } from './errors';

const firsConfigSchema = z.object({
  baseUrl: z.url().default('https://api.firs.gov.ng'),
  apiKey: z.string(),
  apiSecret: z.string(),
  testEntityApiKey: z.string().optional(),
  testEntityApiSecret: z.string().optional(),
  testBusinessId: z.string().optional(),
  testEntityId: z.string().optional(),
  erpName: z.string().optional(),
  reportBaseUrl: z.string().url().optional(),
  useTestEntity: z.boolean().default(false),
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
      testEntityApiKey: process.env.FIRS_TEST_ENTITY_API_KEY,
      testEntityApiSecret: process.env.FIRS_TEST_ENTITY_API_SECRET,
      testBusinessId: process.env.FIRS_TEST_BUSINESS_ID,
      testEntityId: process.env.FIRS_TEST_ENTITY_ID,
      erpName: process.env.FIRS_ERP_NAME,
      reportBaseUrl: process.env.FIRS_REPORT_BASE_URL,
      useTestEntity: process.env.FIRS_USE_TEST_ENTITY === 'true',
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
