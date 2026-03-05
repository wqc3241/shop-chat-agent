/**
 * In-Memory Cache Service
 * Provides TTL-based caching for expensive network operations.
 * Cache lives in module scope — persists across requests within the same process.
 */

/** @type {Map<string, { data: any, expiresAt: number }>} */
const store = new Map();

/**
 * Get a value from the cache. Returns null on miss or expiration (lazy eviction).
 * @param {string} key
 * @returns {any|null}
 */
export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Set a value in the cache with a TTL.
 * @param {string} key
 * @param {any} data
 * @param {number} ttlMs - Time-to-live in milliseconds
 */
export function cacheSet(key, data, ttlMs) {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Delete a specific cache entry.
 * @param {string} key
 */
export function cacheDelete(key) {
  store.delete(key);
}

// Cache key builders
export const CACHE_KEYS = {
  storefrontTools: (endpoint) => `sf_tools:${endpoint}`,
  customerAccountUrls: (domain) => `cust_urls:${domain}`,
};

// TTL constants
export const CACHE_TTL = {
  storefrontTools: 5 * 60 * 1000,       // 5 minutes
  customerAccountUrls: 10 * 60 * 1000,  // 10 minutes
};
