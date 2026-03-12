import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateRequiredEnvVars, verifyEnvVars } from '~/env.server.js';

/**
 * Tests for env.server.js validation functions.
 *
 * The module loads dotenv on import (side effect), which may set env vars from .env.
 * We snapshot and restore env vars around each test to isolate the validation logic.
 * The env vars are manipulated AFTER import so dotenv side effects don't interfere.
 */
describe('validateRequiredEnvVars', () => {
  let originalOpenAI;
  let originalShopify;

  beforeEach(() => {
    originalOpenAI = process.env.OPENAI_API_KEY;
    originalShopify = process.env.SHOPIFY_API_KEY;
  });

  afterEach(() => {
    // Restore env values
    if (originalOpenAI !== undefined) {
      process.env.OPENAI_API_KEY = originalOpenAI;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    if (originalShopify !== undefined) {
      process.env.SHOPIFY_API_KEY = originalShopify;
    } else {
      delete process.env.SHOPIFY_API_KEY;
    }
  });

  it('throws when OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    process.env.SHOPIFY_API_KEY = 'sk-test-shopify';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => validateRequiredEnvVars()).toThrow('OPENAI_API_KEY');

    console.error.mockRestore();
  });

  it('throws when SHOPIFY_API_KEY is missing', () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    delete process.env.SHOPIFY_API_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => validateRequiredEnvVars()).toThrow('SHOPIFY_API_KEY');

    console.error.mockRestore();
  });

  it('throws when both keys are missing', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.SHOPIFY_API_KEY;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => validateRequiredEnvVars()).toThrow('Missing required environment variables');

    console.error.mockRestore();
  });

  it('does not throw when both keys are set', () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    process.env.SHOPIFY_API_KEY = 'sk-test-shopify';

    expect(() => validateRequiredEnvVars()).not.toThrow();
  });
});

describe('verifyEnvVars', () => {
  let originalOpenAI;
  let originalShopify;

  beforeEach(() => {
    originalOpenAI = process.env.OPENAI_API_KEY;
    originalShopify = process.env.SHOPIFY_API_KEY;
  });

  afterEach(() => {
    if (originalOpenAI !== undefined) {
      process.env.OPENAI_API_KEY = originalOpenAI;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    if (originalShopify !== undefined) {
      process.env.SHOPIFY_API_KEY = originalShopify;
    } else {
      delete process.env.SHOPIFY_API_KEY;
    }
  });

  it('returns correct flags when both keys are present', () => {
    process.env.OPENAI_API_KEY = 'sk-test-openai';
    process.env.SHOPIFY_API_KEY = 'sk-test-shopify';

    const result = verifyEnvVars();

    expect(result.hasOpenAIApiKey).toBe(true);
    expect(result.hasShopifyApiKey).toBe(true);
    expect(result).toHaveProperty('loaded');
    expect(result).toHaveProperty('envPath');
  });

  it('returns false flags when keys are missing', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.SHOPIFY_API_KEY;

    const result = verifyEnvVars();

    expect(result.hasOpenAIApiKey).toBe(false);
    expect(result.hasShopifyApiKey).toBe(false);
  });
});
