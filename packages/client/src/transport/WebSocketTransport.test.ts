import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { WebSocketTransport } from './WebSocketTransport';

/** Enough of a WHATWG WebSocket for partysocket to drive. */
class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  binaryType = 'blob';
  sent: string[] = [];
  closeCalls = 0;

  constructor(readonly url: string) {
    super();
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
    this.readyState = 3;
  }

  serverOpen(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  serverSend(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  serverClose(): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code: 1006 }));
  }
}

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

async function waitUntil(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await tick(1);
  }
}

function makeTransport(options: { reconnectionDelay?: number; reconnectionDelayMax?: number } = {}) {
  return new WebSocketTransport('wss://server.example', {
    ...options,
    WebSocket: FakeWebSocket as unknown as typeof WebSocket,
  });
}

/** Connects and waits for the underlying socket, which partysocket opens asynchronously. */
async function connect(transport: WebSocketTransport): Promise<FakeWebSocket> {
  const before = FakeWebSocket.instances.length;
  transport.connect();
  await waitUntil(() => FakeWebSocket.instances.length > before);
  return FakeWebSocket.latest;
}

const customEvent = (name: string, value: unknown) => JSON.stringify({ type: 'CUSTOM', name, value });

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

  test('opens a socket at the configured url', async () => {
    const transport = makeTransport();
    const socket = await connect(transport);

    expect(socket.url).toBe('wss://server.example');

    transport.disconnect();
  });

  test('an AG-UI event frame is delivered on the event channel', async () => {
    const transport = makeTransport();
    const events: unknown[] = [];
    transport.on('event', data => events.push(data));

    const socket = await connect(transport);
    socket.serverOpen();
    socket.serverSend(JSON.stringify({ type: 'RUN_STARTED', threadId: 't', runId: 'r' }));

    expect(events).toEqual([{ type: 'RUN_STARTED', threadId: 't', runId: 'r' }]);

    transport.disconnect();
  });

  test('CUSTOM events named agents and config are delivered on their own channels', async () => {
    const transport = makeTransport();
    const events: unknown[] = [];
    const agents: unknown[] = [];
    const configs: unknown[] = [];
    transport.on('event', data => events.push(data));
    transport.on('agents', data => agents.push(data));
    transport.on('config', data => configs.push(data));

    const socket = await connect(transport);
    socket.serverOpen();
    socket.serverSend(customEvent('agents', { agents: [], defaultAgent: 'claude' }));
    socket.serverSend(customEvent('config', { langfuseEnabled: true }));

    expect(agents).toEqual([{ agents: [], defaultAgent: 'claude' }]);
    expect(configs).toEqual([{ langfuseEnabled: true }]);
    expect(events).toEqual([]);

    transport.disconnect();
  });

  test('delivers a frame to every subscriber of its channel', async () => {
    const transport = makeTransport();
    const first: unknown[] = [];
    const second: unknown[] = [];
    transport.on('agents', data => first.push(data));
    transport.on('agents', data => second.push(data));

    const socket = await connect(transport);
    socket.serverOpen();
    socket.serverSend(customEvent('agents', { agents: [], defaultAgent: 'claude' }));

    expect(first).toEqual([{ agents: [], defaultAgent: 'claude' }]);
    expect(second).toEqual([{ agents: [], defaultAgent: 'claude' }]);

    transport.disconnect();
  });

  test('unsubscribing stops delivery', async () => {
    const transport = makeTransport();
    const events: unknown[] = [];
    const unsubscribe = transport.on('event', data => events.push(data));

    const socket = await connect(transport);
    socket.serverOpen();
    socket.serverSend(JSON.stringify({ type: 'STEP_STARTED', stepName: '1' }));
    unsubscribe();
    socket.serverSend(JSON.stringify({ type: 'STEP_STARTED', stepName: '2' }));

    expect(events).toEqual([{ type: 'STEP_STARTED', stepName: '1' }]);

    transport.disconnect();
  });

  test('a CUSTOM event with an unknown name passes through as an event', async () => {
    const transport = makeTransport();
    const events: unknown[] = [];
    transport.on('event', data => events.push(data));

    const socket = await connect(transport);
    socket.serverOpen();
    socket.serverSend(customEvent('a_name_from_a_later_version', {}));

    // UseAIClient ignores event types it does not handle, so passing it on is safe.
    expect(events).toEqual([{ type: 'CUSTOM', name: 'a_name_from_a_later_version', value: {} }]);
    expect(transport.connected).toBe(true);

    transport.disconnect();
  });

  test('a malformed frame is ignored, not an error', async () => {
    const transport = makeTransport();
    const events: unknown[] = [];
    transport.on('event', data => events.push(data));

    const socket = await connect(transport);
    socket.serverOpen();

    expect(() => socket.serverSend('not json')).not.toThrow();
    expect(() => socket.serverSend(JSON.stringify({ noTypeHere: true }))).not.toThrow();
    expect(() => socket.serverSend(new ArrayBuffer(4))).not.toThrow();

    socket.serverSend(JSON.stringify({ type: 'RUN_FINISHED' }));
    expect(events).toEqual([{ type: 'RUN_FINISHED' }]);
    expect(transport.connected).toBe(true);

    transport.disconnect();
  });

  test('send serializes the message with nothing wrapped around it', async () => {
    const transport = makeTransport();
    const socket = await connect(transport);
    socket.serverOpen();

    transport.send({ type: 'abort_run', data: { runId: 'run-1' } });

    expect(socket.sent).toEqual(['{"type":"abort_run","data":{"runId":"run-1"}}']);

    transport.disconnect();
  });

  test('connected follows the socket opening and closing', async () => {
    const transport = makeTransport({ reconnectionDelay: 10_000 });
    expect(transport.connected).toBe(false);

    const socket = await connect(transport);
    expect(transport.connected).toBe(false);

    socket.serverOpen();
    expect(transport.connected).toBe(true);

    socket.serverClose();
    expect(transport.connected).toBe(false);

    transport.disconnect();
  });

  test('a close after opening dispatches disconnect', async () => {
    const transport = makeTransport({ reconnectionDelay: 10_000 });
    const states: string[] = [];
    transport.on('connect', () => states.push('connect'));
    transport.on('disconnect', () => states.push('disconnect'));

    const socket = await connect(transport);
    socket.serverOpen();
    socket.serverClose();

    expect(states).toEqual(['connect', 'disconnect']);

    transport.disconnect();
  });

  test('a failed connection attempt does not dispatch disconnect', async () => {
    const transport = makeTransport({ reconnectionDelay: 10_000 });
    const states: string[] = [];
    transport.on('disconnect', () => states.push('disconnect'));

    const socket = await connect(transport);
    // Never opened: the socket closes straight from the connecting state.
    socket.serverClose();

    expect(states).toEqual([]);

    transport.disconnect();
  });

  test('reconnects after the socket drops', async () => {
    const transport = makeTransport({ reconnectionDelay: 1, reconnectionDelayMax: 2 });
    const socket = await connect(transport);
    socket.serverOpen();

    socket.serverClose();
    await waitUntil(() => FakeWebSocket.instances.length > 1);

    FakeWebSocket.latest.serverOpen();
    expect(transport.connected).toBe(true);

    transport.disconnect();
  });

  test('keeps retrying while attempts fail', async () => {
    const transport = makeTransport({ reconnectionDelay: 1, reconnectionDelayMax: 2 });
    await connect(transport);

    for (let i = 0; i < 3; i++) {
      const count = FakeWebSocket.instances.length;
      FakeWebSocket.latest.serverClose();
      await waitUntil(() => FakeWebSocket.instances.length > count);
    }

    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(4);

    transport.disconnect();
  });

  test('disconnect() stops the retries', async () => {
    const transport = makeTransport({ reconnectionDelay: 1, reconnectionDelayMax: 2 });
    const socket = await connect(transport);
    socket.serverOpen();

    socket.serverClose();
    transport.disconnect();
    const openedByNow = FakeWebSocket.instances.length;

    await tick(20);

    expect(FakeWebSocket.instances).toHaveLength(openedByNow);
    expect(transport.connected).toBe(false);
  });

  test('disconnect() closes the open socket', async () => {
    const transport = makeTransport();
    const socket = await connect(transport);
    socket.serverOpen();

    transport.disconnect();

    expect(socket.closeCalls).toBe(1);
    expect(transport.connected).toBe(false);
  });
});
