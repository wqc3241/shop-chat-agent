import { describe, it, expect } from 'vitest';
import { cacheGet, cacheSet, cacheDelete, CACHE_KEYS, CACHE_TTL } from '~/services/cache.server.js';

describe('cache service', () => {
  describe('cacheSet + cacheGet', () => {
    it('returns cached data within TTL', () => {
      cacheSet('test-key-1', { foo: 'bar' }, 5000);
      const result = cacheGet('test-key-1');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('works with primitive values', () => {
      cacheSet('test-primitive', 42, 5000);
      expect(cacheGet('test-primitive')).toBe(42);
    });
  });

  describe('cacheGet miss', () => {
    it('returns null for a key that was never set', () => {
      expect(cacheGet('nonexistent-key')).toBeNull();
    });
  });

  describe('cacheGet expiration', () => {
    it('returns null for an expired entry', async () => {
      cacheSet('expire-key', 'temp', 1); // 1ms TTL
      // Wait just enough for the entry to expire
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(cacheGet('expire-key')).toBeNull();
    });
  });

  describe('cacheDelete', () => {
    it('removes an entry from the cache', () => {
      cacheSet('delete-key', 'value', 5000);
      expect(cacheGet('delete-key')).toBe('value');
      cacheDelete('delete-key');
      expect(cacheGet('delete-key')).toBeNull();
    });
  });

  describe('CACHE_KEYS builders', () => {
    it('storefrontTools produces the correct format', () => {
      expect(CACHE_KEYS.storefrontTools('https://example.com')).toBe('sf_tools:https://example.com');
    });

    it('customerAccountUrls produces the correct format', () => {
      expect(CACHE_KEYS.customerAccountUrls('shop.myshopify.com')).toBe('cust_urls:shop.myshopify.com');
    });
  });

  describe('CACHE_TTL values', () => {
    it('all TTL values are positive numbers', () => {
      for (const [key, value] of Object.entries(CACHE_TTL)) {
        expect(value, `CACHE_TTL.${key}`).toBeTypeOf('number');
        expect(value, `CACHE_TTL.${key}`).toBeGreaterThan(0);
      }
    });
  });
});
