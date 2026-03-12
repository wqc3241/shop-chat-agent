import { describe, it, expect, vi } from 'vitest';
import { createStreamManager, createSseStream } from '~/services/streaming.server.js';

/**
 * Build a mock controller + encoder pair for testing createStreamManager.
 * Returns the controller mock and a helper to collect all enqueued chunks as strings.
 */
function makeMocks() {
  const chunks = [];
  const encoder = new TextEncoder();
  const controller = {
    enqueue: vi.fn((encoded) => {
      chunks.push(new TextDecoder().decode(encoded));
    }),
    close: vi.fn(),
  };
  return { encoder, controller, chunks };
}

describe('createStreamManager', () => {
  describe('sendMessage', () => {
    it('enqueues data in SSE format', () => {
      const { encoder, controller, chunks } = makeMocks();
      const mgr = createStreamManager(encoder, controller);

      mgr.sendMessage({ type: 'text', content: 'hello' });

      expect(controller.enqueue).toHaveBeenCalledOnce();
      const sent = chunks[0];
      expect(sent).toMatch(/^data: /);
      expect(sent).toMatch(/\n\n$/);
      const parsed = JSON.parse(sent.replace('data: ', '').trim());
      expect(parsed).toEqual({ type: 'text', content: 'hello' });
    });
  });

  describe('sendError', () => {
    it('sends error data through the stream', () => {
      const { encoder, controller, chunks } = makeMocks();
      const mgr = createStreamManager(encoder, controller);

      mgr.sendError({ type: 'error', error: 'Something broke', details: 'details here' });

      expect(controller.enqueue).toHaveBeenCalledOnce();
      const parsed = JSON.parse(chunks[0].replace('data: ', '').trim());
      expect(parsed.type).toBe('error');
      expect(parsed.error).toBe('Something broke');
      expect(parsed.details).toBe('details here');
    });
  });

  describe('closeStream', () => {
    it('closes the controller', () => {
      const { encoder, controller } = makeMocks();
      const mgr = createStreamManager(encoder, controller);

      mgr.closeStream();

      expect(controller.close).toHaveBeenCalledOnce();
    });
  });

  describe('handleStreamingError', () => {
    it('detects auth errors (status 401)', () => {
      const { encoder, controller, chunks } = makeMocks();
      const mgr = createStreamManager(encoder, controller);

      // Suppress expected console.error output
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mgr.handleStreamingError({ status: 401, message: 'Unauthorized' });

      const parsed = JSON.parse(chunks[0].replace('data: ', '').trim());
      expect(parsed.type).toBe('error');
      expect(parsed.error).toContain('Authentication failed');
      expect(parsed.details).toContain('API key');

      console.error.mockRestore();
    });

    it('detects auth errors by message content', () => {
      const { encoder, controller, chunks } = makeMocks();
      const mgr = createStreamManager(encoder, controller);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mgr.handleStreamingError({ message: 'Invalid auth token' });

      const parsed = JSON.parse(chunks[0].replace('data: ', '').trim());
      expect(parsed.type).toBe('error');
      expect(parsed.error).toContain('Authentication failed');

      console.error.mockRestore();
    });

    it('detects rate limit errors (status 429)', () => {
      const { encoder, controller, chunks } = makeMocks();
      const mgr = createStreamManager(encoder, controller);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mgr.handleStreamingError({ status: 429, message: 'Too many requests' });

      const parsed = JSON.parse(chunks[0].replace('data: ', '').trim());
      expect(parsed.type).toBe('rate_limit_exceeded');
      expect(parsed.error).toContain('Rate limit');

      console.error.mockRestore();
    });

    it('detects overloaded errors (status 529)', () => {
      const { encoder, controller, chunks } = makeMocks();
      const mgr = createStreamManager(encoder, controller);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mgr.handleStreamingError({ status: 529, message: 'Overloaded' });

      const parsed = JSON.parse(chunks[0].replace('data: ', '').trim());
      expect(parsed.type).toBe('rate_limit_exceeded');

      console.error.mockRestore();
    });

    it('handles generic errors', () => {
      const { encoder, controller, chunks } = makeMocks();
      const mgr = createStreamManager(encoder, controller);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mgr.handleStreamingError({ status: 500, message: 'Internal server error' });

      const parsed = JSON.parse(chunks[0].replace('data: ', '').trim());
      expect(parsed.type).toBe('error');
      expect(parsed.error).toContain('Failed to get response');
      expect(parsed.details).toBe('Internal server error');

      console.error.mockRestore();
    });
  });
});

describe('createSseStream', () => {
  it('creates a ReadableStream', () => {
    const stream = createSseStream(async () => {});
    expect(stream).toBeInstanceOf(ReadableStream);
  });

  it('invokes the stream handler and closes the stream', async () => {
    const handler = vi.fn(async (mgr) => {
      mgr.sendMessage({ type: 'text', content: 'streamed' });
    });

    const stream = createSseStream(handler);
    const reader = stream.getReader();

    // Read until done
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    expect(handler).toHaveBeenCalledOnce();
    expect(chunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(chunks[0].replace('data: ', '').trim());
    expect(parsed).toEqual({ type: 'text', content: 'streamed' });
  });

  it('catches errors from the handler and sends them as error events', async () => {
    // Suppress expected console.error output
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const stream = createSseStream(async () => {
      const err = new Error('handler blew up');
      err.status = 500;
      throw err;
    });

    const reader = stream.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    expect(chunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(chunks[0].replace('data: ', '').trim());
    expect(parsed.type).toBe('error');

    console.error.mockRestore();
  });
});
