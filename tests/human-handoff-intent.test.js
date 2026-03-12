/**
 * Tests for the NLP-based human handoff intent detection.
 *
 * The isHumanHandoffIntent function lives in the client-side chat.js,
 * so we extract the same regex patterns here for unit testing.
 */
import { describe, it, expect } from 'vitest';

// Mirror the patterns from chat.js isHumanHandoffIntent
const patterns = [
  /\b(talk|speak|chat)\b.*\b(person|human|agent|representative|rep|someone|somebody|staff|manager|support)\b/,
  /\b(person|human|agent|representative|rep|someone|somebody|staff|manager|support)\b.*\b(talk|speak|chat)\b/,
  /\b(want|need|get|connect|transfer)\b.*\b(human|person|agent|representative|rep|someone|real person|live agent|live chat|live support)\b/,
  /\bhuman\s*(help|assistance|support|agent)\b/,
  /\breal\s*person\b/,
  /\blive\s*(agent|chat|support|person|representative)\b/,
  /\btransfer\s*(me|to)\b/,
  /\bconnect\s*me\b.*\b(agent|person|human|representative|support)\b/,
  /\bno\b.*\b(bot|ai|robot|automated)\b/,
  /\bstop\b.*\b(bot|ai)\b.*\b(talk|speak|chat)\b/,
];

function isHumanHandoffIntent(message) {
  const normalized = message.toLowerCase().trim();
  return patterns.some((pattern) => pattern.test(normalized));
}

describe('Human handoff intent detection', () => {
  describe('should detect handoff intent', () => {
    const positives = [
      'I want to talk to a person',
      'I want to talk to a representative',
      'Can I speak to a human?',
      'I need to talk to someone',
      'Let me talk to a real person',
      'I want to chat with an agent',
      'Can I speak with a representative',
      'I need a human agent',
      'Connect me to a person please',
      'Transfer me to support',
      'I want live chat',
      'Can I get a live agent?',
      'I need human help',
      'I want human assistance',
      'I need human support',
      'Get me a representative',
      'No more bot, I want a person',
      'I want to talk to a staff member',
      'Can I speak to a manager?',
      'I want live support',
      'transfer me to an agent',
      'TALK TO A PERSON PLEASE',
      'i want to speak to somebody',
      'connect me to a human representative',
      'I need a real person',
    ];

    positives.forEach((msg) => {
      it(`detects: "${msg}"`, () => {
        expect(isHumanHandoffIntent(msg)).toBe(true);
      });
    });
  });

  describe('should NOT detect handoff intent for normal messages', () => {
    const negatives = [
      'What products do you have?',
      'Help me find a coilover for my Audi',
      'What is your return policy?',
      'How much does shipping cost?',
      'Can you help me with my order?',
      'I want to buy this product',
      'Show me brake pads',
      'Does this fit my 2020 Honda Civic?',
      'Tell me about your warranty',
      'Where is my order?',
      'Hello',
      'Thanks for your help!',
      'The person who sold me this was great',
      'I talked to someone last week about this',
      'My representative said the order shipped',
    ];

    negatives.forEach((msg) => {
      it(`ignores: "${msg}"`, () => {
        expect(isHumanHandoffIntent(msg)).toBe(false);
      });
    });
  });
});
