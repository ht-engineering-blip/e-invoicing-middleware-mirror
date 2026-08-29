/**
 * In-Memory TTL & LRU Cache Helper
 * High-performance, bounded in-memory cache for high-throughput API requests
 * Prevents redundant database queries for static/semi-static data (e.g. tenant credentials, schemas, system configs)
 */

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class TTLCache<K = string, V = any> {
  private cache = new Map<K, CacheEntry<V>>();
  private maxItems: number;
  private defaultTtlMs: number;

  constructor(options?: { maxItems?: number; defaultTtlMs?: number }) {
    this.maxItems = options?.maxItems || 1000;
    this.defaultTtlMs = options?.defaultTtlMs || 60_000; // 1 minute default
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    if (this.cache.size >= this.maxItems) {
      // Evict oldest (first inserted in Map iteration order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.cache.set(key, { value, expiresAt });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Get or compute if absent
   */
  async getOrSet(
    key: K,
    fetcher: () => Promise<V>,
    ttlMs?: number,
  ): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }
}
