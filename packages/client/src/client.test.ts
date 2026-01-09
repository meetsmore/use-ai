import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import type { Socket } from 'socket.io-client';

// Store event handlers registered via socket.on()
let eventHandlers: Record<string, Function[]> = {};
let mockSocket: Partial<Socket> & { connected: boolean };

function createMockSocket() {
  eventHandlers = {};
  mockSocket = {
    on: mock((event: string, handler: Function) => {
      if (!eventHandlers[event]) eventHandlers[event] = [];
      eventHandlers[event].push(handler);
      return mockSocket as Socket;
    }),
    emit: mock(() => mockSocket as Socket),
    connected: false,
    disconnect: mock(() => mockSocket as Socket),
    io: {
      engine: {
        transport: { name: 'polling' },
        on: mock(),
      },
    } as any,
  };
  return mockSocket as Socket;
}

// Helper to emit socket events in tests
function emitSocketEvent(event: string, ...args: any[]) {
  eventHandlers[event]?.forEach(handler => handler(...args));
}

// Mock socket.io-client module
mock.module('socket.io-client', () => ({
  io: () => createMockSocket(),
}));

// Import after mocking
const { UseAIClient } = await import('./client');

describe('UseAIClient', () => {
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

  describe('connect()', () => {
    test('notifies connected state on successful connection', () => {
      const client = new UseAIClient('http://localhost:8081');
      const stateChanges: boolean[] = [];

      client.onConnectionStateChange((connected) => {
        stateChanges.push(connected);
      });

      client.connect();

      // Simulate successful connection
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Initial state (false) + connected (true)
      expect(stateChanges).toEqual([false, true]);
    });

    test('notifies disconnected state on disconnect', () => {
      const client = new UseAIClient('http://localhost:8081');
      const stateChanges: boolean[] = [];

      client.onConnectionStateChange((connected) => {
        stateChanges.push(connected);
      });

      client.connect();

      // Connect first
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Then disconnect
      mockSocket.connected = false;
      emitSocketEvent('disconnect', 'transport close');

      expect(stateChanges).toEqual([false, true, false]);
    });

    test('logs warning on connection error without throwing', () => {
      const client = new UseAIClient('http://localhost:8081');

      client.connect();

      // Simulate connection error
      emitSocketEvent('connect_error', new Error('Connection refused'));

      // Should use console.warn, not console.error
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[UseAI] Connection error:',
        'Connection refused'
      );
    });
  });

  describe('reconnection scenarios', () => {
    test('reconnects successfully after 2 failed attempts', () => {
      const client = new UseAIClient('http://localhost:8081');
      const stateChanges: boolean[] = [];

      client.onConnectionStateChange((connected) => {
        stateChanges.push(connected);
      });

      client.connect();

      // 1st attempt: connection error
      emitSocketEvent('connect_error', new Error('Attempt 1 failed'));

      // 2nd attempt: connection error
      emitSocketEvent('connect_error', new Error('Attempt 2 failed'));

      // 3rd attempt: success
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Initial (false) + connected (true)
      // Connection errors don't change state, only connect/disconnect events do
      expect(stateChanges).toEqual([false, true]);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    });

    test('reconnects after disconnect', () => {
      const client = new UseAIClient('http://localhost:8081');
      const stateChanges: boolean[] = [];

      client.onConnectionStateChange((connected) => {
        stateChanges.push(connected);
      });

      client.connect();

      // Initial connection
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Disconnect
      mockSocket.connected = false;
      emitSocketEvent('disconnect', 'transport close');

      // Reconnect after 1 failed attempt
      emitSocketEvent('connect_error', new Error('Reconnect attempt 1 failed'));

      // Successful reconnection
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // false (initial) -> true (connect) -> false (disconnect) -> true (reconnect)
      expect(stateChanges).toEqual([false, true, false, true]);
    });

    test('handles multiple disconnect/reconnect cycles', () => {
      const client = new UseAIClient('http://localhost:8081');
      const stateChanges: boolean[] = [];

      client.onConnectionStateChange((connected) => {
        stateChanges.push(connected);
      });

      client.connect();

      // Cycle 1: connect
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Cycle 1: disconnect
      mockSocket.connected = false;
      emitSocketEvent('disconnect', 'ping timeout');

      // Cycle 2: reconnect
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Cycle 2: disconnect
      mockSocket.connected = false;
      emitSocketEvent('disconnect', 'transport error');

      // Cycle 3: reconnect
      mockSocket.connected = true;
      emitSocketEvent('connect');

      expect(stateChanges).toEqual([false, true, false, true, false, true]);
    });
  });

  describe('onConnectionStateChange()', () => {
    test('immediately notifies current state on subscribe', () => {
      const client = new UseAIClient('http://localhost:8081');
      const stateChanges: boolean[] = [];

      client.connect();

      // Connect first
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Subscribe after connection - should immediately get current state
      client.onConnectionStateChange((connected) => {
        stateChanges.push(connected);
      });

      expect(stateChanges).toEqual([true]);
    });

    test('unsubscribe stops notifications', () => {
      const client = new UseAIClient('http://localhost:8081');
      const stateChanges: boolean[] = [];

      const unsubscribe = client.onConnectionStateChange((connected) => {
        stateChanges.push(connected);
      });

      client.connect();

      // Connect
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Unsubscribe
      unsubscribe();

      // Disconnect - should not be notified
      mockSocket.connected = false;
      emitSocketEvent('disconnect', 'transport close');

      // Only initial (false) + connect (true), no disconnect notification
      expect(stateChanges).toEqual([false, true]);
    });

    test('supports multiple subscribers', () => {
      const client = new UseAIClient('http://localhost:8081');
      const stateChanges1: boolean[] = [];
      const stateChanges2: boolean[] = [];

      client.onConnectionStateChange((connected) => {
        stateChanges1.push(connected);
      });

      client.onConnectionStateChange((connected) => {
        stateChanges2.push(connected);
      });

      client.connect();

      mockSocket.connected = true;
      emitSocketEvent('connect');

      expect(stateChanges1).toEqual([false, true]);
      expect(stateChanges2).toEqual([false, true]);
    });
  });

  describe('isConnected()', () => {
    test('returns false before connect', () => {
      const client = new UseAIClient('http://localhost:8081');
      expect(client.isConnected()).toBe(false);
    });

    test('returns true when connected', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();

      mockSocket.connected = true;
      emitSocketEvent('connect');

      expect(client.isConnected()).toBe(true);
    });

    test('returns false after disconnect', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();

      mockSocket.connected = true;
      emitSocketEvent('connect');

      mockSocket.connected = false;
      emitSocketEvent('disconnect', 'transport close');

      expect(client.isConnected()).toBe(false);
    });
  });
});
