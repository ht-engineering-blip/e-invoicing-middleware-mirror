import { z } from 'zod';
import { handleConfigError } from './errors';

const redisConfigSchema = z.object({
  url: z.string().url().default('redis://localhost:6379'),
  options: z.object({
    maxRetriesPerRequest: z.number().int().nonnegative().default(3),
    enableReadyCheck: z.boolean().default(true),
  }),
});

const parseRedisConfig = () => {
  try {
    return redisConfigSchema.parse({
      url: process.env.REDIS_URL,
      options: {
        maxRetriesPerRequest: process.env.REDIS_MAX_RETRIES
          ? Number(process.env.REDIS_MAX_RETRIES)
          : undefined,
        enableReadyCheck: process.env.REDIS_ENABLE_READY_CHECK
          ? process.env.REDIS_ENABLE_READY_CHECK === 'true'
          : undefined,
      },
    });
  } catch (error) {
    handleConfigError('redis', error);
  }
};

export const redisConfig = parseRedisConfig();
