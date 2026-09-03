import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { WebSocketTransport, type WebSocketLike } from './WebSocketTransport';

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];

  sent: string[] = [];
  closeCalls = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  static get latest(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls++;
  }

  /** Simulates the server accepting the connection. */
  serverOpen(): void {
    this.onopen?.({});
  }

  /** Simulates a frame arriving from the server. */
  serverSend(data: unknown): void {
    this.onmessage?.({ data });
  }

  /** Simulates the connection dropping. */
  serverClose(): void {
    this.onclose?.({});
  }
}

function makeTransport(options: { reconnectionDelay?: number; reconnectionDelayMax?: number } = {}) {
  return new WebSocketTransport('wss://server.example/ws', {
    ...options,
    createWebSocket: (url) => new FakeWebSocket(url),
  });
}

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('WebSocketTransport', () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  test('opens a socket at the configured url', () => {
    const transport = makeTransport();
    transport.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.latest.url).toBe('wss://server.example/ws');

    transport.disconnect();
  });

  test('an incoming frame calls the handlers for its name', () => {
    const transport = makeTransport();
    const events: unknown[] = [];
    const configs: unknown[] = [];
    transport.on('event', data => events.push(data));
    transport.on('config', data => configs.push(data));

    transport.connect();
    FakeWebSocket.latest.serverOpen();

    FakeWebSocket.latest.serverSend(JSON.stringify({ name: 'event', data: { type: 'RUN_STARTED' } }));
    FakeWebSocket.latest.serverSend(JSON.stringify({ name: 'config', data: { langfuseEnabled: true } }));

    expect(events).toEqual([{ type: 'RUN_STARTED' }]);
    expect(configs).toEqual([{ langfuseEnabled: true }]);

    transport.disconnect();
  });

  test('delivers a frame to every subscriber of its name', () => {
    const transport = makeTransport();
    const first: unknown[] = [];
    const second: unknown[] = [];
    transport.on('agents', data => first.push(data));
    transport.on('agents', data => second.push(data));

    transport.connect();
    FakeWebSocket.latest.serverOpen();
    FakeWebSocket.latest.serverSend(
      JSON.stringify({ name: 'agents', data: { agents: [], defaultAgent: 'claude' } }),
    );

    expect(first).toEqual([{ agents: [], defaultAgent: 'claude' }]);
    expect(second).toEqual([{ agents: [], defaultAgent: 'claude' }]);

    transport.disconnect();
  });

  test('unsubscribing stops delivery', () => {
    const transport = makeTransport();
    const events: unknown[] = [];
    const unsubscribe = transport.on('event', data => events.push(data));

    transport.connect();
    FakeWebSocket.latest.serverOpen();
    FakeWebSocket.latest.serverSend(JSON.stringify({ name: 'event', data: 1 }));
    unsubscribe();
    FakeWebSocket.latest.serverSend(JSON.stringify({ name: 'event', data: 2 }));

    expect(events).toEqual([1]);

    transport.disconnect();
  });

  test('a frame with an unknown name is ignored, not an error', () => {
    const transport = makeTransport();
    const events: unknown[] = [];
    transport.on('event', data => events.push(data));

    transport.connect();
    FakeWebSocket.latest.serverOpen();

    expect(() => {
      FakeWebSocket.latest.serverSend(JSON.stringify({ name: 'a_name_from_a_later_version', data: {} }));
    }).not.toThrow();

    // The connection survives, so the next known frame still arrives.
    FakeWebSocket.latest.serverSend(JSON.stringify({ name: 'event', data: 'still here' }));
    expect(events).toEqual(['still here']);
    expect(transport.connected).toBe(true);

    transport.disconnect();
  });

  test('a malformed frame is ignored, not an error', () => {
    const transport = makeTransport();
    const events: unknown[] = [];
    transport.on('event', data => events.push(data));

    transport.connect();
    FakeWebSocket.latest.serverOpen();

    expect(() => FakeWebSocket.latest.serverSend('not json')).not.toThrow();
    expect(() => FakeWebSocket.latest.serverSend(JSON.stringify({ noNameHere: true }))).not.toThrow();

    FakeWebSocket.latest.serverSend(JSON.stringify({ name: 'event', data: 'still here' }));
    expect(events).toEqual(['still here']);

    transport.disconnect();
  });

  test('send serializes the message with nothing wrapped around it', () => {
    const transport = makeTransport();
    transport.connect();
    FakeWebSocket.latest.serverOpen();

    transport.send({ type: 'abort_run', data: { runId: 'run-1' } });

    expect(FakeWebSocket.latest.sent).toEqual(['{"type":"abort_run","data":{"runId":"run-1"}}']);

    transport.disconnect();
  });

  test('connected follows the socket opening and closing', () => {
    const transport = makeTransport({ reconnectionDelay: 10_000 });
    expect(transport.connected).toBe(false);

    transport.connect();
    expect(transport.connected).toBe(false);

    FakeWebSocket.latest.serverOpen();
    expect(transport.connected).toBe(true);

    FakeWebSocket.latest.serverClose();
    expect(transport.connected).toBe(false);

    transport.disconnect();
  });

  test('a close after opening dispatches disconnect', () => {
    const transport = makeTransport({ reconnectionDelay: 10_000 });
    const states: string[] = [];
    transport.on('connect', () => states.push('connect'));
    transport.on('disconnect', () => states.push('disconnect'));

    transport.connect();
    FakeWebSocket.latest.serverOpen();
    FakeWebSocket.latest.serverClose();

    expect(states).toEqual(['connect', 'disconnect']);

    transport.disconnect();
  });

  test('a failed connection attempt does not dispatch disconnect', () => {
    const transport = makeTransport({ reconnectionDelay: 10_000 });
    const states: string[] = [];
    transport.on('disconnect', () => states.push('disconnect'));

    transport.connect();
    // Never opened: the socket closes straight from the connecting state.
    FakeWebSocket.latest.serverClose();

    expect(states).toEqual([]);

    transport.disconnect();
  });

  test('backoff reconnects after the socket drops', async () => {
    const transport = makeTransport({ reconnectionDelay: 1, reconnectionDelayMax: 2 });
    transport.connect();
    FakeWebSocket.latest.serverOpen();
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.latest.serverClose();
    await tick(20);

    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);

    // The reconnected socket is live: opening it restores connected.
    FakeWebSocket.latest.serverOpen();
    expect(transport.connected).toBe(true);

    transport.disconnect();
  });

  test('backoff keeps retrying while attempts fail', async () => {
    const transport = makeTransport({ reconnectionDelay: 1, reconnectionDelayMax: 2 });
    transport.connect();

    for (let i = 0; i < 3; i++) {
      FakeWebSocket.latest.serverClose();
      await tick(10);
    }

    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(4);

    transport.disconnect();
  });

  test('disconnect() stops the backoff', async () => {
    const transport = makeTransport({ reconnectionDelay: 1, reconnectionDelayMax: 2 });
    transport.connect();
    FakeWebSocket.latest.serverOpen();

    FakeWebSocket.latest.serverClose();
    transport.disconnect();
    const openedByNow = FakeWebSocket.instances.length;

    await tick(20);

    expect(FakeWebSocket.instances).toHaveLength(openedByNow);
    expect(transport.connected).toBe(false);
  });

  test('disconnect() closes the open socket', () => {
    const transport = makeTransport();
    transport.connect();
    FakeWebSocket.latest.serverOpen();

    const socket = FakeWebSocket.latest;
    transport.disconnect();

    expect(socket.closeCalls).toBe(1);
    expect(transport.connected).toBe(false);
  });
});
