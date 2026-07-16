// Logger implementation will be added here
// Using pino for high-performance JSON logging

export const logger = {
  info: (message: string, data?: unknown) => {
    console.log('[INFO] %s', message, data || '');
  },
  error: (message: string, error?: unknown) => {
    console.error('[ERROR] %s', message, error || '');
  },
  warn: (message: string, data?: unknown) => {
    console.warn('[WARN] %s', message, data || '');
  },
  debug: (message: string, data?: unknown) => {
    console.debug('[DEBUG] %s', message, data || '');
  },
};

