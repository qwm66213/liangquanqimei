/**
 * Simple in-memory cache with TTL (time-to-live).
 *
 * Currently only used for static data (product meta).
 */

const store = new Map<string, { data: unknown; expiresAt: number }>();

/** Static lookup data (product meta etc.) */
export const STATIC_TTL = 60 * 60 * 1000; // 1 hour

const DEFAULT_TTL = STATIC_TTL;

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function cacheSet(key: string, data: unknown, ttlMs = DEFAULT_TTL): void {
  store.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/** Periodic cleanup: remove expired entries every 10 minutes */
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.expiresAt) store.delete(key);
    }
  }, 10 * 60 * 1000);
}
