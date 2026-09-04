import mongoose from "mongoose";
import { logger } from "../../../../@lib";
import {
  CircuitBreakerState,
  CircuitBreakerStateModel,
} from "../../models/circuit-breaker-state.model";

export interface CircuitBreakerKey {
  tenantId?: string;
  provider?: string;
}

interface BreakerRecord {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number;
}

const DEFAULT_RECORD: BreakerRecord = {
  state: CircuitBreakerState.CLOSED,
  failureCount: 0,
  lastFailureTime: 0,
};

/**
 * Circuit breaker guarding LLM calls in the transformer.
 *
 * State is keyed per tenant + provider and persisted in Mongo, so:
 *   - one tenant hitting a rate limit does not block every other tenant, and
 *   - every API/worker process sees the same state (the previous in-memory
 *     singleton meant a retry landing on the same process was blocked by the
 *     previous attempt's failure, while a retry on another process was not).
 *
 * The breaker is deliberately fail-open: if the state store is unreachable we
 * allow the call rather than blocking transforms on a bookkeeping failure.
 */
export class TransformerCircuitBreaker {
  private static instance: TransformerCircuitBreaker;

  private readonly threshold = 3;
  private readonly cooldownMs = 120_000; // 2 minutes

  /** Short-lived local mirror so repeated reads in one transform are cheap. */
  private readonly localCache = new Map<
    string,
    { record: BreakerRecord; readAt: number }
  >();
  private readonly localCacheTtlMs = 1_000;

  /** Used when Mongo is not connected (tests, startup before DB connect). */
  private readonly memoryStore = new Map<string, BreakerRecord>();

  private constructor() {}

  /** Mongo is only usable once the connection is actually established. */
  private isPersistenceAvailable(): boolean {
    return mongoose.connection?.readyState === 1;
  }

  static getInstance(): TransformerCircuitBreaker {
    if (!TransformerCircuitBreaker.instance) {
      TransformerCircuitBreaker.instance = new TransformerCircuitBreaker();
    }
    return TransformerCircuitBreaker.instance;
  }

  private buildKey(key?: CircuitBreakerKey): string {
    const tenant = key?.tenantId || "global";
    const provider = key?.provider || "default";
    return `transformer:${tenant}:${provider}`;
  }

  private async load(docKey: string): Promise<BreakerRecord> {
    const cached = this.localCache.get(docKey);
    if (cached && Date.now() - cached.readAt < this.localCacheTtlMs) {
      return cached.record;
    }

    if (!this.isPersistenceAvailable()) {
      return this.memoryStore.get(docKey) ?? { ...DEFAULT_RECORD };
    }

    try {
      const doc = await CircuitBreakerStateModel.findOne({ key: docKey }).lean();
      const record: BreakerRecord = doc
        ? {
            state: doc.state ?? CircuitBreakerState.CLOSED,
            failureCount: doc.failureCount ?? 0,
            lastFailureTime: doc.lastFailureTime ?? 0,
          }
        : { ...DEFAULT_RECORD };
      this.localCache.set(docKey, { record, readAt: Date.now() });
      return record;
    } catch (err: any) {
      logger.warn(
        `[CircuitBreaker] Could not read state for ${docKey}, failing open: ${err?.message || err}`,
      );
      return { ...DEFAULT_RECORD };
    }
  }

  private async persist(
    docKey: string,
    record: BreakerRecord,
    lastError?: string,
  ): Promise<void> {
    this.localCache.set(docKey, { record, readAt: Date.now() });
    this.memoryStore.set(docKey, record);

    if (!this.isPersistenceAvailable()) return;

    try {
      await CircuitBreakerStateModel.updateOne(
        { key: docKey },
        { $set: { ...record, ...(lastError ? { lastError } : {}) } },
        { upsert: true },
      );
    } catch (err: any) {
      logger.warn(
        `[CircuitBreaker] Could not persist state for ${docKey}: ${err?.message || err}`,
      );
    }
  }

  /**
   * Whether LLM calls are currently allowed for this tenant/provider.
   */
  async canExecute(key?: CircuitBreakerKey): Promise<boolean> {
    const docKey = this.buildKey(key);
    const record = await this.load(docKey);

    if (record.state !== CircuitBreakerState.OPEN) return true;

    if (Date.now() - record.lastFailureTime > this.cooldownMs) {
      await this.persist(docKey, {
        ...record,
        state: CircuitBreakerState.HALF_OPEN,
      });
      logger.info(
        `[CircuitBreaker] ${docKey} transitioning to HALF_OPEN to test LLM connectivity`,
      );
      return true;
    }

    return false;
  }

  /**
   * How long the caller must wait before the breaker will reopen, in seconds.
   * Returns 0 when calls are already allowed.
   */
  async cooldownRemainingSeconds(key?: CircuitBreakerKey): Promise<number> {
    const record = await this.load(this.buildKey(key));
    if (record.state !== CircuitBreakerState.OPEN) return 0;
    const remaining = this.cooldownMs - (Date.now() - record.lastFailureTime);
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  async recordSuccess(key?: CircuitBreakerKey): Promise<void> {
    const docKey = this.buildKey(key);
    const record = await this.load(docKey);
    if (
      record.state === CircuitBreakerState.CLOSED &&
      record.failureCount === 0
    ) {
      return;
    }
    await this.persist(docKey, { ...DEFAULT_RECORD });
    logger.info(`[CircuitBreaker] ${docKey} reset to CLOSED after success`);
  }

  /**
   * Records a failed LLM call.
   *
   * A rate limit counts towards the threshold like any other failure — it no
   * longer trips the breaker on its own. A single 429 previously locked the
   * breaker open for two minutes, which is what made an immediate retry
   * reuse the same degraded path instead of calling the LLM again.
   */
  async recordFailure(error: unknown, key?: CircuitBreakerKey): Promise<void> {
    const docKey = this.buildKey(key);
    const record = await this.load(docKey);
    const errMsg = error instanceof Error ? error.message : String(error);

    const failureCount = record.failureCount + 1;
    const next: BreakerRecord = {
      state: record.state,
      failureCount,
      lastFailureTime: Date.now(),
    };

    if (failureCount >= this.threshold) {
      next.state = CircuitBreakerState.OPEN;
      logger.warn(
        `[CircuitBreaker] ${docKey} tripped OPEN after ${failureCount} consecutive LLM failures: ${errMsg}. Cooldown: ${this.cooldownMs / 1000}s`,
      );
    } else {
      // A HALF_OPEN trial that fails goes straight back to OPEN.
      if (record.state === CircuitBreakerState.HALF_OPEN) {
        next.state = CircuitBreakerState.OPEN;
      }
      logger.warn(
        `[CircuitBreaker] ${docKey} recorded LLM failure ${failureCount}/${this.threshold}: ${errMsg}`,
      );
    }

    await this.persist(docKey, next, errMsg);
  }

  async reset(key?: CircuitBreakerKey): Promise<void> {
    const docKey = this.buildKey(key);
    this.localCache.delete(docKey);
    this.memoryStore.delete(docKey);
    await this.persist(docKey, { ...DEFAULT_RECORD });
  }

  async getState(key?: CircuitBreakerKey): Promise<CircuitBreakerState> {
    return (await this.load(this.buildKey(key))).state;
  }
}

/**
 * True when an error is a provider rate limit.
 *
 * Checks the HTTP status first and only then falls back to message text. The
 * previous `/429|rate\s*limit|.../` test matched a bare "429" anywhere in the
 * message, so an amount like 1429.00 or an id containing 429 tripped the
 * breaker as if the provider had rate limited us.
 */
export function isRateLimitError(error: any): boolean {
  const status =
    error?.status ?? error?.statusCode ?? error?.response?.status ?? undefined;
  if (status === 429) return true;

  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /\b429\b|rate\s*limit|too\s*many\s*requests/i.test(msg);
}
