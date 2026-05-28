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

      // Server emits STEP_FINISHED after the tool-call step (the real AISDKAgent
      // emits one per step), which flushes assistant(toolCalls) + tool_result.
      emitSocketEvent('event', { type: 'STEP_FINISHED' });

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

    test('TOOL_CALL_RESULT stores server-side tool result in conversation history', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Simulate sending a user message
      client.sendPrompt('What is the weather in Tokyo?');

      // Server-side tool call (MCP tool) — client does NOT call sendToolResponse
      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' });
      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 'toolu_mcp_1', toolCallName: 'mcp_get_weather' });
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 'toolu_mcp_1', delta: '{"location":"Tokyo"}' });
      emitSocketEvent('event', { type: 'TOOL_CALL_END', toolCallId: 'toolu_mcp_1' });

      // Server sends the actual MCP tool result via TOOL_CALL_RESULT
      emitSocketEvent('event', {
        type: 'TOOL_CALL_RESULT',
        messageId: 'msg-result-1',
        toolCallId: 'toolu_mcp_1',
        content: '{"temperature":15,"condition":"cloudy"}',
        role: 'tool',
      });

      // STEP_FINISHED flushes the tool-call step (assistant(toolCalls) + result).
      emitSocketEvent('event', { type: 'STEP_FINISHED' });

      // Server sends final text response
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'It is 15°C and cloudy in Tokyo.' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' });
      emitSocketEvent('event', { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' });

      const messages = client.messages;
      expect(messages).toHaveLength(4); // user, assistant(toolCalls), tool, assistant(text)

      const toolResult = messages[2];
      expect(toolResult.role).toBe('tool');
      expect(toolResult.content).toBe('{"temperature":15,"condition":"cloudy"}');
      expect((toolResult as Record<string, unknown>).toolCallId).toBe('toolu_mcp_1');
    });

    test('TOOL_CALL_RESULT does not duplicate result for client-side tools', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      client.sendPrompt('Add a todo: buy groceries');

      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' });
      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 'toolu_client_1', toolCallName: 'addTodo' });
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 'toolu_client_1', delta: '{"text":"buy groceries"}' });
      emitSocketEvent('event', { type: 'TOOL_CALL_END', toolCallId: 'toolu_client_1' });

      // Client executes tool and sends result (this pushes to _pendingToolResults)
      client.sendToolResponse('toolu_client_1', { success: true });

      // Server also sends TOOL_CALL_RESULT for the same toolCallId (should be deduplicated)
      emitSocketEvent('event', {
        type: 'TOOL_CALL_RESULT',
        messageId: 'msg-result-dup',
        toolCallId: 'toolu_client_1',
        content: '{"success":true}',
        role: 'tool',
      });

      // STEP_FINISHED flushes the tool-call step (assistant(toolCalls) + result).
      emitSocketEvent('event', { type: 'STEP_FINISHED' });

      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Done!' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' });
      emitSocketEvent('event', { type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' });

      const messages = client.messages;
      const toolResults = messages.filter(m => m.role === 'tool');
      expect(toolResults).toHaveLength(1); // Only one, not duplicated
    });

    test('abortRun emits abort_run with the in-flight runId from sendPrompt', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      client.sendPrompt('Hello');
      const runId = client.currentRunId;
      expect(typeof runId).toBe('string');

      // Clear prior emit calls (run_agent) for a clean assertion.
      const emitMock = mockSocket.emit as ReturnType<typeof mock>;
      emitMock.mockClear();

      client.abortRun();

      expect(emitMock).toHaveBeenCalledWith('message', {
        type: 'abort_run',
        data: { runId },
      });
    });

    test('abortRun is a no-op when no run is in flight', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      const emitMock = mockSocket.emit as ReturnType<typeof mock>;
      emitMock.mockClear();

      client.abortRun();

      expect(emitMock).not.toHaveBeenCalled();
    });

    test('currentRunId is cleared after RUN_FINISHED', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      client.sendPrompt('Hello');
      expect(client.currentRunId).not.toBeNull();

      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'm' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_END', messageId: 'm' });
      emitSocketEvent('event', { type: 'RUN_FINISHED', threadId: 't', runId: 'r' });

      expect(client.currentRunId).toBeNull();
    });

    test('currentRunId is cleared after RUN_ERROR', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      client.sendPrompt('Hello');
      expect(client.currentRunId).not.toBeNull();

      emitSocketEvent('event', { type: 'RUN_ERROR', message: 'ABORTED' });

      expect(client.currentRunId).toBeNull();
    });

    test('stopping while a tool is still running backfills results for the unanswered tool calls', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      client.sendPrompt('Add two todos');

      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      // Two tool_use blocks streamed, but the client never responds for the
      // second one (aborted mid-execution).
      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'addTodo' });
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"text":"a"}' });
      emitSocketEvent('event', { type: 'TOOL_CALL_END', toolCallId: 'tc1' });
      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 'tc2', toolCallName: 'addTodo' });
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 'tc2', delta: '{"text":"b"}' });
      emitSocketEvent('event', { type: 'TOOL_CALL_END', toolCallId: 'tc2' });

      // Only the first tool got a result before abort.
      client.sendToolResponse('tc1', { ok: 1 });

      client.finalizeRun({ aborted: true });

      const msgs = client.messages;
      // user + assistant(toolCalls) + tool(tc1) + tool(tc2-synthetic)
      expect(msgs).toHaveLength(4);

      const assistant = msgs[1] as Record<string, unknown>;
      expect(assistant.role).toBe('assistant');
      const toolCalls = assistant.toolCalls as Array<{ id: string }>;
      expect(toolCalls.map(t => t.id)).toEqual(['tc1', 'tc2']);

      const tools = msgs.filter(m => m.role === 'tool') as Array<{ toolCallId?: string; content: string }>;
      expect(tools.map(t => t.toolCallId).sort()).toEqual(['tc1', 'tc2']);

      const synthetic = tools.find(t => t.toolCallId === 'tc2');
      expect(synthetic).toBeDefined();
      expect(JSON.parse(synthetic!.content)).toMatchObject({ aborted: true });
    });

    test('stopping mid-TOOL_CALL_ARGS (before TOOL_CALL_END) leaves no orphaned tool_use in history', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      client.sendPrompt('Add a todo');

      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'addTodo' });
      // Partial args delta — TOOL_CALL_END never arrives before abort.
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"text":"buy' });

      client.finalizeRun({ aborted: true });

      const msgs = client.messages;
      // Only the user message: the half-streamed tool_use has no TOOL_CALL_END so
      // it never moved to _currentAssistantToolCalls. No orphaned tool_use block,
      // no assistant message without a matching tool_result.
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe('user');

      const assistantWithToolCalls = msgs.filter(
        m => m.role === 'assistant' && (m as Record<string, unknown>).toolCalls,
      );
      expect(assistantWithToolCalls).toHaveLength(0);

      // No partial text was streamed.
      expect(client.currentMessageContent).toBe('');

      // finalizeAbortedRun clears in-progress reasoning blocks.
      expect(client.currentReasoningBlocks).toEqual([]);

    });

    test('does not duplicate the step text in _messages after a STEP_FINISHED → ABORT sequence', () => {
      // Regression: aborting between STEP_FINISHED and the next TEXT_MESSAGE_START used to save the step text twice.
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      client.sendPrompt('test prompt');

      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      emitSocketEvent('event', { type: 'STEP_STARTED', stepName: 'step-0' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'm1' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'step text' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_END', messageId: 'm1' });
      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'testTool' });
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{}' });
      emitSocketEvent('event', { type: 'TOOL_CALL_END', toolCallId: 'tc1' });
      emitSocketEvent('event', { type: 'TOOL_CALL_RESULT', messageId: 'tr1', toolCallId: 'tc1', content: '[]', role: 'tool' });
      emitSocketEvent('event', { type: 'STEP_FINISHED', stepName: 'step-0' });

      client.finalizeRun({ aborted: true });

      const textMatches = (client.messages as Array<Record<string, unknown>>).filter(
        m => m.role === 'assistant' && m.content === 'step text',
      );
      expect(textMatches).toHaveLength(1);
      expect(textMatches[0].toolCalls).toBeDefined();
      expect((textMatches[0].toolCalls as Array<{ id: string }>)[0].id).toBe('tc1');
    });

    test('a tool-only aborted run does not leak the previous run\'s text', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      // Run 1: ends with a final text answer.
      client.sendPrompt('list the tools');
      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 't', runId: 'r1' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'm1' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Here are the tools' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_END', messageId: 'm1' });
      emitSocketEvent('event', { type: 'RUN_FINISHED', threadId: 't', runId: 'r1' });

      // Run 2: tool-only step (no TEXT_MESSAGE_START), aborted mid-execution.
      // RUN_STARTED must reset the leftover text so it is not persisted again.
      client.sendPrompt('wait 5 seconds');
      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 't', runId: 'r2' });
      expect(client.currentMessageContent).toBe('');

      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'wait' });
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"seconds":5}' });
      emitSocketEvent('event', { type: 'TOOL_CALL_END', toolCallId: 'tc1' });
      client.finalizeRun({ aborted: true });

      // No assistant message carries the run-1 text after run 2's abort.
      const leaked = client.messages.filter(
        m => m.role === 'assistant' && m.content === 'Here are the tools' && !(m as Record<string, unknown>).toolCalls,
      );
      expect(leaked).toHaveLength(1); // only the legitimate run-1 message
    });

    test('stopping while the assistant is streaming text keeps the partial text', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      client.sendPrompt('Tell me a story');

      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'm' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'Once upon a' });
      // Note: no TEXT_MESSAGE_END — mid-stream abort.

      client.finalizeRun({ aborted: true });

      const msgs = client.messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].content).toBe('Once upon a');
    });

    test('stopping while the assistant is reasoning drops the unfinished thinking but keeps earlier steps\' reasoning', () => {
      const client = new UseAIClient('http://localhost:8081');
      client.connect();
      mockSocket.connected = true;
      emitSocketEvent('connect');

      client.sendPrompt('Do two things');

      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: 't', runId: 'r' });

      // Step 1: complete reasoning + tool_use + STEP_FINISHED. Reasoning gets
      // attached to the step-1 assistant message and survives the abort.
      emitSocketEvent('event', { type: 'REASONING_MESSAGE_START', messageId: 'rm1' });
      emitSocketEvent('event', { type: 'REASONING_MESSAGE_CONTENT', messageId: 'rm1', delta: 'think 1' });
      emitSocketEvent('event', { type: 'REASONING_MESSAGE_END', messageId: 'rm1' });
      emitSocketEvent('event', { type: 'REASONING_ENCRYPTED_VALUE', subtype: 'message', encryptedValue: 'sig1' });
      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'doThing' });
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{}' });
      emitSocketEvent('event', { type: 'TOOL_CALL_END', toolCallId: 'tc1' });
      client.sendToolResponse('tc1', { ok: 1 });
      emitSocketEvent('event', { type: 'STEP_FINISHED' });

      // Step 2: reasoning streamed but END/encrypted not received before abort.
      emitSocketEvent('event', { type: 'REASONING_MESSAGE_START', messageId: 'rm2' });
      emitSocketEvent('event', { type: 'REASONING_MESSAGE_CONTENT', messageId: 'rm2', delta: 'think 2 partial' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'm2' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'About to' });

      client.finalizeRun({ aborted: true });

      // Step 1's reasoning is preserved on its flushed assistant message.
      const step1Assistant = client.messages[1] as Record<string, unknown>;
      expect(step1Assistant.role).toBe('assistant');
      expect(Array.isArray(step1Assistant.reasoningParts)).toBe(true);
      expect((step1Assistant.reasoningParts as Array<{ text: string }>)[0].text).toBe('think 1');

      // Aborted step (step 2): partial text saved as a plain assistant
      // message with no reasoningParts attached.
      const last = client.messages[client.messages.length - 1] as Record<string, unknown>;
      expect(last.role).toBe('assistant');
      expect(last.content).toBe('About to');
      expect(last.reasoningParts).toBeUndefined();

      // The in-progress reasoning buffer is dropped.
      expect(client.currentReasoningBlocks).toEqual([]);
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
