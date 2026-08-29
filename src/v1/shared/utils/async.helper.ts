/**
 * Async Execution and Retry Helpers
 * Provides non-blocking exponential backoff with jitter for resilient network/API operations.
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  shouldRetry?: (error: any, attempt: number) => boolean;
  onRetry?: (error: any, attempt: number, nextDelayMs: number) => void;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 500,
    maxDelayMs = 5000,
    backoffFactor = 2,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt > maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }

      // Calculate exponential backoff with full jitter
      const jitter = Math.random() * delay;
      const currentDelay = Math.min(delay + jitter, maxDelayMs);

      if (onRetry) {
        onRetry(error, attempt, currentDelay);
      }

      await new Promise((resolve) => setTimeout(resolve, currentDelay));
      delay = Math.min(delay * backoffFactor, maxDelayMs);
    }
  }
}
