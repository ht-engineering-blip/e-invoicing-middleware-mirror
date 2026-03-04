import { z } from 'zod';
import { handleConfigError } from './errors';

const appConfigSchema = z.object({
  port: z.coerce.number().int().positive(),
  adminKey: z.string(),
  env: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  apiVersion: z.string().default('v1'),
  host: z.string().default('0.0.0.0'),
  inferenceModel: z.string().default('gpt-4-turbo-preview'),
  webAppURL: z.url().default("https://e-invoicing-sandbox.vercel.app"),
  apiBaseURL: z.url().default("https://e-invoicing-sandbox.vercel.app")
});

const parseAppConfig = () => {
  try {
    return appConfigSchema.parse({
      port: process.env.APP_PORT || 3001,
      adminKey: process.env.DEFAULT_ADMIN_KEY || "dummy_key",
      env: process.env.NODE_ENV || 'development',
      apiVersion: process.env.API_VERSION || 'v1',
      host: process.env.HOST || '0.0.0.0',
      webAppURL: process.env.WEB_APP_URL || "https://e-invoicing-sandbox.vercel.app",
      apiBaseURL: process.env.API_BASE_URL || "https://e-invoicing-middleware.vercel.app"
    });
  } catch (error) {
    handleConfigError('app', error);
  }
};

export const appConfig = parseAppConfig();
