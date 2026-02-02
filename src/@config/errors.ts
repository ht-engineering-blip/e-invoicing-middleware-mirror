import { ZodError } from 'zod';
import { logger } from '../@lib/logger';

export class ConfigValidationError extends Error {
  constructor(
    public readonly configName: string,
    public readonly errors: ZodError
  ) {
    super(`Configuration validation failed for ${configName}`);
    this.name = 'ConfigValidationError';
  }
}

export const handleConfigError = (configName: string, error: unknown): never => {
  if (error instanceof ZodError) {
    logger.error(`Configuration validation failed for ${configName}:`, error.issues);
    throw new ConfigValidationError(configName, error);
  }
  throw error;
};

