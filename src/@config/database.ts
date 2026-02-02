import { z } from 'zod';
import { handleConfigError } from './errors';

const databaseConfigSchema = z.object({
  mongoUri: z.string().url().default('mongodb://localhost:27017/e-invoicing'),
  dbName: z.string().default("e-invoicing-middleware"),
  mongoOptions: z.object({
    maxPoolSize: z.number().int().positive().default(10),
    minPoolSize: z.number().int().nonnegative().default(2),
  })
});

const parseDatabaseConfig = () => {
  try {
    return databaseConfigSchema.safeParse({
      mongoUri: process.env.MONGODB_URI,
      dbName: process.env.DB_NAME,
      mongoOptions: {
        maxPoolSize: process.env.MONGODB_MAX_POOL_SIZE
          ? Number(process.env.MONGODB_MAX_POOL_SIZE)
          : undefined,
        minPoolSize: process.env.MONGODB_MIN_POOL_SIZE
          ? Number(process.env.MONGODB_MIN_POOL_SIZE)
          : undefined,
      },
    });
  } catch (error) {
    handleConfigError('database', error);
  }
};

export const databaseConfig = parseDatabaseConfig();
