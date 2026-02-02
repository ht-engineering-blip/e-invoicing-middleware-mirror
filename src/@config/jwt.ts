import { z } from 'zod';
import { handleConfigError } from './errors';

const jwtConfigSchema = z.object({
  secret: z.string().min(32, 'JWT secret must be at least 32 characters').default('your-secret-key-change-in-production-min-32-chars'),
  expiry: z.string().default('24h'),
  algorithm: z.enum(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512']).default('HS256'),
});

const parseJwtConfig = () => {
  try {
    return jwtConfigSchema.parse({
      secret: process.env.JWT_SECRET,
      expiry: process.env.JWT_EXPIRY,
      algorithm: process.env.JWT_ALGORITHM,
    });
  } catch (error) {
    handleConfigError('jwt', error);
  }
};

export const jwtConfig = parseJwtConfig();
