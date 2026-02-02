import { DB_NAME } from '../../api-env.ts';

/**
 * MongoDB settings configuration
 * Centralizes MongoDB-specific configuration
 */
export const settings = {
    dbName: DB_NAME
} as const; 