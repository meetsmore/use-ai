import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { installSocketIOMock } from '../../test/socketIOMock';

// Socket.IO builds its own socket, so the module is the only seam for testing
// this transport's wiring. Everything above it is tested through a transport
// instead: see client.test.ts.
const sio = installSocketIOMock();
const { SocketIOTransport } = await import('./SocketIOTransport');

describe('SocketIOTransport', () => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  test('reconnects indefinitely with backoff capped at ten seconds', () => {
    new SocketIOTransport('http://localhost:8081').connect();

    expect(sio.ioOptions).toMatchObject({
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      withCredentials: true,
    });
  });

  test('reports connection changes with the Socket.IO reason', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    const changes: Array<[boolean, string | undefined]> = [];
    transport.onConnectionChange((connected, reason) => changes.push([connected, reason]));

    transport.connect();
    sio.fire('connect');
    sio.fire('disconnect', 'transport close');

    expect(changes).toEqual([[true, undefined], [false, 'transport close']]);
  });

  test('delivers AG-UI events, and presents agents and config as CUSTOM events', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    const events: unknown[] = [];
    transport.onEvent(event => events.push(event));

    transport.connect();
    sio.fire('event', { type: 'RUN_STARTED' });
    sio.fire('agents', { agents: [], defaultAgent: 'claude' });
    sio.fire('config', { langfuseEnabled: true });

    expect(events).toEqual([
      { type: 'RUN_STARTED' },
      expect.objectContaining({ type: 'CUSTOM', name: 'agents', value: { agents: [], defaultAgent: 'claude' } }),
      expect.objectContaining({ type: 'CUSTOM', name: 'config', value: { langfuseEnabled: true } }),
    ]);
  });

  test('logs a warning on connection error without throwing', () => {
    new SocketIOTransport('http://localhost:8081').connect();

    sio.fire('connect_error', new Error('Connection refused'));

    // Warn, not error: console.error triggers the Next.js error overlay.
    expect(consoleWarnSpy).toHaveBeenCalledWith('[UseAI] Connection error:', 'Connection refused');
  });

  test('repeated connection errors do not report a connection change', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    const changes: boolean[] = [];
    transport.onConnectionChange(connected => changes.push(connected));

    transport.connect();
    sio.fire('connect_error', new Error('Attempt 1 failed'));
    sio.fire('connect_error', new Error('Attempt 2 failed'));
    sio.fire('connect');

    expect(changes).toEqual([true]);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
  });

  test('logs transport upgrades', () => {
    new SocketIOTransport('http://localhost:8081').connect();
    sio.fire('connect');

    expect(consoleLogSpy).toHaveBeenCalledWith('[UseAI] Transport:', 'polling');

    sio.fire('engine:upgrade', { name: 'websocket' });
    expect(consoleLogSpy).toHaveBeenCalledWith('[UseAI] Upgraded to transport:', 'websocket');

    sio.fire('engine:upgradeError', { message: 'upgrade failed' });
    expect(consoleWarnSpy).toHaveBeenCalledWith('[UseAI] Upgrade error:', 'upgrade failed');
  });

  test('send emits the message on the message channel', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    transport.connect();
    sio.socket.connected = true;

    transport.send({ type: 'abort_run', data: { runId: 'run-1' } });

    expect(sio.socket.emit).toHaveBeenCalledWith('message', { type: 'abort_run', data: { runId: 'run-1' } });
  });

  test('connected follows the socket', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    expect(transport.connected).toBe(false);

    transport.connect();
    sio.socket.connected = true;
    expect(transport.connected).toBe(true);

    sio.socket.connected = false;
    expect(transport.connected).toBe(false);
  });

  test('disconnect closes the socket and reports disconnected', () => {
    const transport = new SocketIOTransport('http://localhost:8081');
    transport.connect();
    sio.socket.connected = true;

    transport.disconnect();

    expect(sio.socket.disconnect).toHaveBeenCalled();
    expect(transport.connected).toBe(false);
  });
});
