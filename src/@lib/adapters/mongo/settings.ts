import { databaseConfig } from '../../../@config/database';

/**
 * MongoDB settings configuration
 * Centralizes MongoDB-specific configuration
 */
export const settings = {
    dbName: databaseConfig?.data?.dbName || 'e-invoicing-middleware'
} as const; 