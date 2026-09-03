import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import type { Socket } from 'socket.io-client';

// Socket.IO builds its own socket, so the module is the only seam for testing
// this transport's wiring. Everything above it is tested through a transport
// instead: see client.test.ts.
let handlers: Record<string, Function[]> = {};
let ioOptions: Record<string, unknown> | undefined;
let mockSocket: Partial<Socket> & { connected: boolean };

function createMockSocket() {
  handlers = {};
  mockSocket = {
    on: mock((event: string, handler: Function) => {
      (handlers[event] ??= []).push(handler);
      return mockSocket as Socket;
    }),
    emit: mock(() => mockSocket as Socket),
    connected: false,
    disconnect: mock(() => mockSocket as Socket),
    io: {
      engine: {
        transport: { name: 'polling' },
        on: mock((event: string, handler: Function) => {
          (handlers[`engine:${event}`] ??= []).push(handler);
        }),
      },
    } as never,
  };
  return mockSocket as Socket;
}

function emitSocketEvent(event: string, ...args: unknown[]) {
  handlers[event]?.forEach(handler => handler(...args));
}

mock.module('socket.io-client', () => ({
  io: (_url: string, options: Record<string, unknown>) => {
    ioOptions = options;
    return createMockSocket();
  },
}));

const { SocketIOTransport } = await import('./SocketIOTransport');

describe('SocketIOTransport', () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    ioOptions = undefined;
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  test('reconnects indefinitely with backoff capped at ten seconds', () => {
    new SocketIOTransport('http://localhost:8081').connect();

    expect(ioOptions).toMatchObject({
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      withCredentials: true,
    });
  });

  test('reconnection delays are configurable', () => {
    new SocketIOTransport('http://localhost:8081', {
      reconnectionDelay: 250,
      reconnectionDelayMax: 2000,
    }).connect();

    expect(ioOptions).toMatchObject({ reconnectionDelay: 250, reconnectionDelayMax: 2000 });
  });

  test('dispatches connect, disconnect and named payloads', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    const received: Array<[string, unknown]> = [];
    for (const name of ['connect', 'disconnect', 'event', 'agents', 'config'] as const) {
      transport.on(name, data => received.push([name, data]));
    }

    transport.connect();

    emitSocketEvent('connect');
    emitSocketEvent('event', { type: 'RUN_STARTED' });
    emitSocketEvent('agents', { agents: [], defaultAgent: 'claude' });
    emitSocketEvent('config', { langfuseEnabled: true });
    emitSocketEvent('disconnect', 'transport close');

    expect(received).toEqual([
      ['connect', undefined],
      ['event', { type: 'RUN_STARTED' }],
      ['agents', { agents: [], defaultAgent: 'claude' }],
      ['config', { langfuseEnabled: true }],
      ['disconnect', 'transport close'],
    ]);
  });

  test('logs a warning on connection error without throwing', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    transport.connect();

    emitSocketEvent('connect_error', new Error('Connection refused'));

    // Warn, not error: console.error triggers the Next.js error overlay.
    expect(consoleWarnSpy).toHaveBeenCalledWith('[UseAI] Connection error:', 'Connection refused');
  });

  test('repeated connection errors do not dispatch a connection state change', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    const states: string[] = [];
    transport.on('connect', () => states.push('connect'));
    transport.on('disconnect', () => states.push('disconnect'));

    transport.connect();

    emitSocketEvent('connect_error', new Error('Attempt 1 failed'));
    emitSocketEvent('connect_error', new Error('Attempt 2 failed'));
    emitSocketEvent('connect');

    expect(states).toEqual(['connect']);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
  });

  test('logs transport upgrades', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    transport.connect();
    emitSocketEvent('connect');

    expect(consoleLogSpy).toHaveBeenCalledWith('[UseAI] Transport:', 'polling');

    emitSocketEvent('engine:upgrade', { name: 'websocket' });
    expect(consoleLogSpy).toHaveBeenCalledWith('[UseAI] Upgraded to transport:', 'websocket');

    emitSocketEvent('engine:upgradeError', { message: 'upgrade failed' });
    expect(consoleWarnSpy).toHaveBeenCalledWith('[UseAI] Upgrade error:', 'upgrade failed');
  });

  test('send emits the message on the message channel', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    transport.connect();
    mockSocket.connected = true;
    emitSocketEvent('connect');

    transport.send({ type: 'abort_run', data: { runId: 'run-1' } });

    expect(mockSocket.emit).toHaveBeenCalledWith('message', {
      type: 'abort_run',
      data: { runId: 'run-1' },
    });
  });

  test('connected follows the socket', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    expect(transport.connected).toBe(false);

    transport.connect();
    mockSocket.connected = true;
    expect(transport.connected).toBe(true);

    mockSocket.connected = false;
    expect(transport.connected).toBe(false);
  });

  test('disconnect closes the socket and reports disconnected', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    transport.connect();
    mockSocket.connected = true;

    transport.disconnect();

    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(transport.connected).toBe(false);
  });
});
