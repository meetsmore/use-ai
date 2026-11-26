import { describe, test, expect, spyOn, afterEach } from 'bun:test';
import { UseAIClient } from './client';
import type { AGUIEvent } from './types';
import type { UseAITransport } from './transport/types';

/** A transport that the test drives by hand. */
class FakeTransport implements UseAITransport {
  readonly url = 'ws://fake';
  connected = false;
  private eventHandler: ((event: AGUIEvent) => void) | null = null;
  connect(): void { this.connected = true; }
  disconnect(): void { this.connected = false; }
  send(): void {}
  onEvent(handler: (event: AGUIEvent) => void): () => void {
    this.eventHandler = handler;
    return () => { this.eventHandler = null; };
  }
  onConnectionChange(): () => void { return () => {}; }
  deliver(event: AGUIEvent): void { this.eventHandler?.(event); }
}

const textEvent = { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hi', timestamp: 0 } as AGUIEvent;

describe('UseAIClient — event handlers', () => {
  let errorSpy: ReturnType<typeof spyOn> | undefined;
  afterEach(() => { errorSpy?.mockRestore(); });

  test('catches and logs a rejection of an async handler', async () => {
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    const transport = new FakeTransport();
    const client = new UseAIClient(transport);
    client.connect();
    client.onEvent('failing', async () => { throw new Error('handler failed'); });

    transport.deliver(textEvent);
    await new Promise(resolve => setTimeout(resolve, 0));
    process.off('unhandledRejection', onUnhandled);

    expect(unhandled).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith('[UseAI] Error in event handler:', expect.any(Error));
  });

  test('still calls the other handlers when one handler throws', () => {
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const transport = new FakeTransport();
    const client = new UseAIClient(transport);
    client.connect();
    const received: AGUIEvent[] = [];
    client.onEvent('throwing', () => { throw new Error('handler failed'); });
    client.onEvent('working', (event) => { received.push(event); });

    transport.deliver(textEvent);

    expect(received).toEqual([textEvent]);
  });
});
