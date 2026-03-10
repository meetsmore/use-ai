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

  describe('sendPrompt()', () => {
    test('sends message without forwardedProps when not provided', async () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();

      mockSocket.connected = true;
      emitSocketEvent('connect');

      await client.sendPrompt('Hello');

      expect(mockSocket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'run_agent',
        data: expect.objectContaining({
          forwardedProps: {},
        }),
      }));
    });

    test('sends message with forwardedProps when provided', async () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();

      mockSocket.connected = true;
      emitSocketEvent('connect');

      await client.sendPrompt('Hello', undefined, {
        mcpHeaders: {
          'https://api.example.com': { headers: { 'Authorization': 'Bearer token' } },
        },
        telemetryMetadata: { userId: 'user-123', evaluationId: 'eval-456' },

      });

      expect(mockSocket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'run_agent',
        data: expect.objectContaining({
          forwardedProps: {
            mcpHeaders: {
              'https://api.example.com': { headers: { 'Authorization': 'Bearer token' } },
            },
            telemetryMetadata: { userId: 'user-123', evaluationId: 'eval-456' },
          },
        }),
      }));
    });

    test('merges forwardedProps with selected agent', async () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();

      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Set selected agent
      client.setAgent('claude-opus');

      await client.sendPrompt('Hello', undefined, {
        telemetryMetadata: { userId: 'user-123' },
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
        type: 'run_agent',
        data: expect.objectContaining({
          forwardedProps: {
            agent: 'claude-opus',
            telemetryMetadata: { userId: 'user-123' },
          },
        }),
      }));
    });
  });

  describe('message ordering after tool call turn', () => {
    function simulateToolCallTurn(client: InstanceType<typeof UseAIClient>) {
      // Simulate sending a user message
      client.sendPrompt('Add a todo: buy groceries');

      // Simulate server events for a tool call turn
      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' });
      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 'toolu_123', toolCallName: 'addTodo' });
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 'toolu_123', delta: '{"text":"buy groceries"}' });
      emitSocketEvent('event', { type: 'TOOL_CALL_END', toolCallId: 'toolu_123' });

      // Client executes tool and sends result
      client.sendToolResponse('toolu_123', { success: true, message: 'Todo added' });

      // Server sends final text response
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: "I've added the todo!" });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' });

      // RUN_FINISHED
      emitSocketEvent('event', { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' });
    }

    test('messages are in correct API order: user → assistant(toolCalls) → tool → assistant(text)', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      simulateToolCallTurn(client);

      const messages = client.messages;

      // Should have 4 messages in correct API order
      expect(messages).toHaveLength(4);

      const [user, assistantToolCall, toolResult, assistantText] = messages;

      expect(user.role).toBe('user');

      expect(assistantToolCall.role).toBe('assistant');
      expect((assistantToolCall as Record<string, unknown>).toolCalls).toBeDefined();
      expect(assistantToolCall.content).toBe('');

      expect(toolResult.role).toBe('tool');
      expect((toolResult as Record<string, unknown>).toolCallId).toBe('toolu_123');

      expect(assistantText.role).toBe('assistant');
      expect(assistantText.content).toBe("I've added the todo!");
      expect((assistantText as Record<string, unknown>).toolCalls).toBeUndefined();
    });

    test('simple text response (no tool calls) still works', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      client.sendPrompt('Hello');

      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Hi there!' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' });
      emitSocketEvent('event', { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' });

      const messages = client.messages;
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('Hi there!');
    });
  });
});
