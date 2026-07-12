// Generic in-process cache primitive: TTL expiry + LRU eviction + single-flight.
//
// Mirrors the openFDA client cache (Map-based, TTL, LRU, failures never cached)
// but adds single-flight de-duplication: concurrent callers requesting the same
// key share ONE in-flight computation instead of each doing the expensive work.
// This is what makes duplicate concurrent AI calls collapse into a single model
// request. Rejections are never cached — a transient failure must not be pinned
// for the whole TTL, and a failed in-flight promise is removed so the next call
// retries.
//
// This is a process-local cache (no external service, by design for this task).

interface CacheEntry<T> {
  expires: number;
  value: T;
}

export interface TtlCache<T> {
  /**
   * Return the cached value for `key`, or run `compute` to produce it. Only
   * successful results are cached. Concurrent calls for the same key await a
   * single shared computation (single-flight).
   */
  get(key: string, compute: () => Promise<T>): Promise<T>;
  /** Drop a single key. */
  invalidate(key: string): void;
  /** Drop everything (used by tests / admin resets). */
  clear(): void;
  /** Current number of resolved entries (excludes in-flight). */
  size(): number;
}

export function createTtlCache<T>(opts: {
  ttlMs: number;
  maxEntries: number;
}): TtlCache<T> {
  const { ttlMs, maxEntries } = opts;
  const cache = new Map<string, CacheEntry<T>>();
  // Tracks computations currently running so duplicate concurrent callers reuse
  // the same promise instead of each launching their own.
  const inflight = new Map<string, Promise<T>>();

  function readFresh(key: string): CacheEntry<T> | null {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expires < Date.now()) {
      cache.delete(key);
      return null;
    }
    // Refresh LRU ordering (Map preserves insertion order).
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  function store(key: string, value: T): void {
    if (!cache.has(key) && cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { expires: Date.now() + ttlMs, value });
  }

  return {
    async get(key: string, compute: () => Promise<T>): Promise<T> {
      const hit = readFresh(key);
      if (hit) return hit.value;

      const pending = inflight.get(key);
      if (pending) return pending;

      const promise = (async () => {
        const value = await compute();
        // Only cache successful results.
        store(key, value);
        return value;
      })();
      inflight.set(key, promise);
      try {
        return await promise;
      } finally {
        // Whether it resolved or rejected, clear the in-flight slot. On success
        // the value is already in `cache`; on failure nothing is cached so the
        // next caller retries.
        inflight.delete(key);
      }
    },
    invalidate(key: string): void {
      cache.delete(key);
    },
    clear(): void {
      cache.clear();
      inflight.clear();
    },
    size(): number {
      return cache.size;
    },
  };
}
