import { logger } from "../../../../@lib";

export class TransformerCircuitBreaker {
  private static instance: TransformerCircuitBreaker;
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold = 3;
  private readonly cooldownMs = 120_000; // 2 minutes cooldown on rate limits / 429

  private constructor() {}

  static getInstance(): TransformerCircuitBreaker {
    if (!TransformerCircuitBreaker.instance) {
      TransformerCircuitBreaker.instance = new TransformerCircuitBreaker();
    }
    return TransformerCircuitBreaker.instance;
  }

  /**
   * Checks whether LLM calls are allowed
   */
  canExecute(): boolean {
    if (this.state === "OPEN") {
      const now = Date.now();
      if (now - this.lastFailureTime > this.cooldownMs) {
        this.state = "HALF_OPEN";
        logger.info("[CircuitBreaker] Transitioning to HALF_OPEN to test LLM connectivity");
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Records a successful execution
   */
  recordSuccess(): void {
    if (this.state === "HALF_OPEN" || this.failureCount > 0) {
      this.state = "CLOSED";
      this.failureCount = 0;
      logger.info("[CircuitBreaker] Reset state to CLOSED following successful execution");
    }
  }

  /**
   * Records a failure (e.g. 429 Rate Limit or 5xx API Error)
   */
  recordFailure(error: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    const errMsg = error instanceof Error ? error.message : String(error);

    const isRateLimit = /429|rate\s*limit|too\s*many\s*requests/i.test(errMsg);

    if (isRateLimit || this.failureCount >= this.threshold) {
      this.state = "OPEN";
      logger.warn(`[CircuitBreaker] Tripped to OPEN state due to LLM error: ${errMsg}. Cooldown: ${this.cooldownMs / 1000}s`);
    }
  }

  /**
   * Resets circuit breaker manually
   */
  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  getState(): "CLOSED" | "OPEN" | "HALF_OPEN" {
    return this.state;
  }
}
