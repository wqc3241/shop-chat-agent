import { describe, it, expect, vi } from 'vitest';
import { createStreamManager } from '~/services/streaming.server';

describe('SSE keepalive', () => {
  function makeMocks() {
    const chunks = [];
    const encoder = { encode: (text) => { chunks.push(text); return text; } };
    const controller = {
      enqueue: vi.fn((chunk) => chunks.push(chunk)),
      close: vi.fn(),
    };
    return { encoder, controller, chunks };
  }

  it('startKeepalive sends comment pings at interval', async () => {
    vi.useFakeTimers();
    const { encoder, controller } = makeMocks();
    const manager = createStreamManager(encoder, controller);

    manager.startKeepalive();

    // Advance 15 seconds — should fire one keepalive
    vi.advanceTimersByTime(15000);
    const keepaliveCall = controller.enqueue.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('keepalive')
    );
    expect(keepaliveCall).toBeDefined();

    manager.stopKeepalive();
    vi.useRealTimers();
  });

  it('stopKeepalive clears the interval', () => {
    vi.useFakeTimers();
    const { encoder, controller } = makeMocks();
    const manager = createStreamManager(encoder, controller);

    manager.startKeepalive();
    manager.stopKeepalive();

    const callCountBefore = controller.enqueue.mock.calls.length;
    vi.advanceTimersByTime(30000);
    // No new keepalive calls after stop
    expect(controller.enqueue.mock.calls.length).toBe(callCountBefore);

    vi.useRealTimers();
  });

  it('manager exposes startKeepalive and stopKeepalive', () => {
    const { encoder, controller } = makeMocks();
    const manager = createStreamManager(encoder, controller);
    expect(manager.startKeepalive).toBeTypeOf('function');
    expect(manager.stopKeepalive).toBeTypeOf('function');
  });
});
