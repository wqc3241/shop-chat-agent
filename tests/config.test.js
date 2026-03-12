import { describe, it, expect } from 'vitest';
import { AppConfig } from '~/services/config.server.js';

describe('AppConfig', () => {
  describe('api', () => {
    it('defaultModel is a valid model name', () => {
      expect(AppConfig.api.defaultModel).toBeTypeOf('string');
      expect(AppConfig.api.defaultModel.length).toBeGreaterThan(0);
      // Must not be a hallucinated model name
      expect(AppConfig.api.defaultModel).not.toBe('gpt-5-mini');
    });

    it('maxTokens is a positive number', () => {
      expect(AppConfig.api.maxTokens).toBeTypeOf('number');
      expect(AppConfig.api.maxTokens).toBeGreaterThan(0);
    });

    it('maxTokens is within a reasonable range', () => {
      expect(AppConfig.api.maxTokens).toBeGreaterThanOrEqual(100);
      expect(AppConfig.api.maxTokens).toBeLessThanOrEqual(10000);
    });
  });

  describe('conversation', () => {
    it('maxHistoryMessages is a positive number', () => {
      expect(AppConfig.conversation.maxHistoryMessages).toBeTypeOf('number');
      expect(AppConfig.conversation.maxHistoryMessages).toBeGreaterThan(0);
    });

    it('maxHistoryMessages is within a reasonable range', () => {
      expect(AppConfig.conversation.maxHistoryMessages).toBeGreaterThanOrEqual(5);
      expect(AppConfig.conversation.maxHistoryMessages).toBeLessThanOrEqual(100);
    });
  });

  describe('timeouts', () => {
    it('all timeout values are positive numbers', () => {
      for (const [key, value] of Object.entries(AppConfig.timeouts)) {
        expect(value, `timeouts.${key}`).toBeTypeOf('number');
        expect(value, `timeouts.${key}`).toBeGreaterThan(0);
      }
    });

    it('timeout values are within reasonable bounds (100ms - 30s)', () => {
      for (const [key, value] of Object.entries(AppConfig.timeouts)) {
        expect(value, `timeouts.${key}`).toBeGreaterThanOrEqual(100);
        expect(value, `timeouts.${key}`).toBeLessThanOrEqual(30000);
      }
    });
  });

  describe('errorMessages', () => {
    it('all error message templates are non-empty strings', () => {
      for (const [key, value] of Object.entries(AppConfig.errorMessages)) {
        expect(value, `errorMessages.${key}`).toBeTypeOf('string');
        expect(value.trim().length, `errorMessages.${key} should not be blank`).toBeGreaterThan(0);
      }
    });
  });
});
