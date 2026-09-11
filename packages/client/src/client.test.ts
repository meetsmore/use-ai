import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import type { UseAIClientMessage } from './types';
import { installSocketIOMock } from '../test/socketIOMock';
import { FakeWebSocket, FakeWebSocketConstructor, waitUntil } from '../test/fakeWebSocket';

/**
 * The UseAIClient suite, run over every bundled transport.
 *
 * Each harness drives its transport at that transport's own wire level, so the
 * two are held to one behaviour. Wiring specific to a single transport is tested
 * next to it, in transport/*.test.ts.
 */

const sio = installSocketIOMock();

// Imported after the module mock so SocketIOTransport picks it up.
const { UseAIClient } = await import('./client');
const { SocketIOTransport } = await import('./transport/SocketIOTransport');
const { WebSocketTransport } = await import('./transport/WebSocketTransport');

type Client = InstanceType<typeof UseAIClient>;

/** Controls over the wire beneath a connected client. */
interface Harness {
  client: Client;
  /**
   * Simulates the connection being accepted. After a drop, waits for the
   * transport's own reconnection first, so the two transports read the same
   * in a test even though only one of them owns its retry loop.
   */
  open(): Promise<void>;
  /** Simulates the connection dropping. */
  close(reason: string): void;
  /** Simulates a named payload arriving from the server. */
  deliver(name: 'event' | 'agents' | 'config', data: unknown): void;
  /** Messages the client has sent upstream, oldest first. */
  sent(): UseAIClientMessage[];
}

const HARNESSES: Array<[string, () => Harness]> = [
  [
    'SocketIOTransport',
    () => {
      const client = new UseAIClient(new SocketIOTransport('http://localhost:8081'));
      client.connect();
      const socket = sio.socket;

      return {
        client,
        async open() {
          socket.connected = true;
          sio.fire('connect');
        },
        close(reason: string) {
          socket.connected = false;
          sio.fire('disconnect', reason);
        },
        deliver(name, data) {
          sio.fire(name, data);
        },
        sent() {
          const emit = socket.emit as unknown as { mock: { calls: unknown[][] } };
          return emit.mock.calls
            .filter(call => call[0] === 'message')
            .map(call => call[1] as UseAIClientMessage);
        },
      };
    },
  ],
  [
    'WebSocketTransport',
    () => {
      FakeWebSocket.reset();
      const client = new UseAIClient(
        new WebSocketTransport('wss://localhost:8081', {
          reconnectionDelay: 1,
          reconnectionDelayMax: 1,
          WebSocket: FakeWebSocketConstructor,
        }),
      );
      client.connect();
      // partysocket opens the socket asynchronously, and opens a fresh one after a drop.
      const liveSocket = async () => {
        await waitUntil(() => FakeWebSocket.latest !== undefined && FakeWebSocket.latest.readyState < 2);
        return FakeWebSocket.latest!;
      };
      const sent: string[] = [];

      return {
        client,
        async open() {
          const socket = await liveSocket();
          socket.sent = sent;
          socket.serverOpen();
        },
        close(reason: string) {
          // The reason a plain WebSocket reports comes from the close frame, not
          // from the caller; the client only logs it.
          void reason;
          FakeWebSocket.latest?.serverClose();
        },
        deliver(name, data) {
          const frame = name === 'event' ? data : { type: 'CUSTOM', name, value: data };
          FakeWebSocket.latest?.serverSend(JSON.stringify(frame));
        },
        sent() {
          return sent.map(frame => JSON.parse(frame) as UseAIClientMessage);
        },
      };
    },
  ],
];

describe.each(HARNESSES)('UseAIClient over %s', (_name, createHarness) => {
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;
  let harness: Harness;
  let client: Client;

  /** The last message the client sent upstream. */
  const lastSent = () => {
    const all = harness.sent();
    return all[all.length - 1];
  };
  const emitEvent = (event: Record<string, unknown>) => harness.deliver('event', event);

  beforeEach(() => {
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    // Never reconnects during a test: the harness owns connection lifecycle.
    harness = createHarness();
    client = harness.client;
  });

  afterEach(() => {
    client.disconnect();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('connection state', () => {
    test('notifies connected state on successful connection', async () => {
      const stateChanges: boolean[] = [];
      client.onConnectionStateChange(connected => stateChanges.push(connected));

      await harness.open();

      // Initial state (false) + connected (true)
      expect(stateChanges).toEqual([false, true]);
    });

    test('notifies disconnected state on disconnect', async () => {
      const stateChanges: boolean[] = [];
      client.onConnectionStateChange(connected => stateChanges.push(connected));

      await harness.open();
      harness.close('transport close');

      expect(stateChanges).toEqual([false, true, false]);
    });

    test('reconnects after disconnect', async () => {
      const stateChanges: boolean[] = [];
      client.onConnectionStateChange(connected => stateChanges.push(connected));

      await harness.open();
      harness.close('transport close');
      await harness.open();

      // false (initial) -> true (connect) -> false (disconnect) -> true (reconnect)
      expect(stateChanges).toEqual([false, true, false, true]);
    });

    test('handles multiple disconnect/reconnect cycles', async () => {
      const stateChanges: boolean[] = [];
      client.onConnectionStateChange(connected => stateChanges.push(connected));

      await harness.open();
      harness.close('ping timeout');
      await harness.open();
      harness.close('transport error');
      await harness.open();

      expect(stateChanges).toEqual([false, true, false, true, false, true]);
    });
  });

  describe('onConnectionStateChange()', () => {
    test('immediately notifies current state on subscribe', async () => {
      const stateChanges: boolean[] = [];

      await harness.open();
      client.onConnectionStateChange(connected => stateChanges.push(connected));

      expect(stateChanges).toEqual([true]);
    });

    test('unsubscribe stops notifications', async () => {
      const stateChanges: boolean[] = [];
      const unsubscribe = client.onConnectionStateChange(connected => stateChanges.push(connected));

      await harness.open();
      unsubscribe();
      harness.close('transport close');

      // Only initial (false) + connect (true), no disconnect notification
      expect(stateChanges).toEqual([false, true]);
    });

    test('supports multiple subscribers', async () => {
      const stateChanges1: boolean[] = [];
      const stateChanges2: boolean[] = [];
      client.onConnectionStateChange(connected => stateChanges1.push(connected));
      client.onConnectionStateChange(connected => stateChanges2.push(connected));

      await harness.open();

      expect(stateChanges1).toEqual([false, true]);
      expect(stateChanges2).toEqual([false, true]);
    });
  });

  describe('isConnected()', () => {
    test('returns false before the connection is accepted', () => {
      expect(client.isConnected()).toBe(false);
    });

    test('returns true when connected', async () => {
      await harness.open();
      expect(client.isConnected()).toBe(true);
    });

    test('returns false after disconnect', async () => {
      await harness.open();
      harness.close('transport close');
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('server payloads', () => {
    test('agents payload updates the available agents', async () => {
      const received: Array<[unknown, unknown]> = [];
      client.onAgentsChange((agents, defaultAgent) => received.push([agents, defaultAgent]));

      await harness.open();
      harness.deliver('agents', {
        agents: [{ id: 'claude', name: 'Claude' }],
        defaultAgent: 'claude',
      });

      expect(client.availableAgents).toEqual([{ id: 'claude', name: 'Claude' }]);
      expect(client.defaultAgent).toBe('claude');
      expect(received[received.length - 1]).toEqual([[{ id: 'claude', name: 'Claude' }], 'claude']);
    });

    test('config payload updates the Langfuse flag', async () => {
      const received: boolean[] = [];
      client.onLangfuseConfigChange(enabled => received.push(enabled));

      await harness.open();
      harness.deliver('config', { langfuseEnabled: true });

      expect(received).toEqual([false, true]);
    });

    test('submitFeedback sends feedback once Langfuse is enabled', async () => {
      await harness.open();
      harness.deliver('config', { langfuseEnabled: true });

      client.submitFeedback('msg-1', 'trace-1', 'upvote');

      expect(lastSent()).toEqual({
        type: 'message_feedback',
        data: { messageId: 'msg-1', traceId: 'trace-1', feedback: 'upvote' },
      });
    });

    test('submitFeedback is a no-op while disconnected', () => {
      client.submitFeedback('msg-1', 'trace-1', 'upvote');

      expect(harness.sent()).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith('[UseAI] Cannot submit feedback: not connected');
    });
  });

  describe('sendPrompt()', async () => {
    test('sends message without forwardedProps when not provided', async () => {
      await harness.open();

      await client.sendPrompt('Hello');

      const message = lastSent();
      expect(message.type).toBe('run_agent');
      expect((message.data as { forwardedProps: unknown }).forwardedProps).toEqual({});
    });

    test('sends message with forwardedProps when provided', async () => {
      await harness.open();

      await client.sendPrompt('Hello', undefined, {
        mcpHeaders: {
          'https://api.example.com': { headers: { Authorization: 'Bearer token' } },
        },
        telemetryMetadata: { userId: 'user-123', evaluationId: 'eval-456' },
      });

      const message = lastSent();
      expect(message.type).toBe('run_agent');
      expect((message.data as { forwardedProps: unknown }).forwardedProps).toEqual({
        mcpHeaders: {
          'https://api.example.com': { headers: { Authorization: 'Bearer token' } },
        },
        telemetryMetadata: { userId: 'user-123', evaluationId: 'eval-456' },
      });
    });

    test('merges forwardedProps with selected agent', async () => {
      await harness.open();
      client.setAgent('claude-opus');

      await client.sendPrompt('Hello', undefined, {
        telemetryMetadata: { userId: 'user-123' },
      });

      const message = lastSent();
      expect(message.type).toBe('run_agent');
      expect((message.data as { forwardedProps: unknown }).forwardedProps).toEqual({
        agent: 'claude-opus',
        telemetryMetadata: { userId: 'user-123' },
      });
    });
  });

  describe('message ordering after tool call turn', async () => {
    function simulateToolCallTurn() {
      // Simulate sending a user message
      client.sendPrompt('Add a todo: buy groceries');

      // Simulate server events for a tool call turn
      emitEvent({ type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' });
      emitEvent({ type: 'TOOL_CALL_START', toolCallId: 'toolu_123', toolCallName: 'addTodo' });
      emitEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 'toolu_123', delta: '{"text":"buy groceries"}' });
      emitEvent({ type: 'TOOL_CALL_END', toolCallId: 'toolu_123' });

      // Client executes tool and sends result
      client.sendToolResponse('toolu_123', { success: true, message: 'Todo added' });

      // Server emits STEP_FINISHED after the tool-call step (the real AISDKAgent
      // emits one per step), which flushes assistant(toolCalls) + tool_result.
      emitEvent({ type: 'STEP_FINISHED' });

      // Server sends final text response
      emitEvent({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
      emitEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: "I've added the todo!" });
      emitEvent({ type: 'TEXT_MESSAGE_END', messageId: 'msg-1' });

      emitEvent({ type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' });
    }

    test('messages are in correct API order: user → assistant(toolCalls) → tool → assistant(text)', async () => {
      await harness.open();

      simulateToolCallTurn();

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

    test('TOOL_CALL_RESULT stores server-side tool result in conversation history', async () => {
      await harness.open();

      client.sendPrompt('What is the weather in Tokyo?');

      // Server-side tool call (MCP tool) — client does NOT call sendToolResponse
      emitEvent({ type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' });
      emitEvent({ type: 'TOOL_CALL_START', toolCallId: 'toolu_mcp_1', toolCallName: 'mcp_get_weather' });
      emitEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 'toolu_mcp_1', delta: '{"location":"Tokyo"}' });
      emitEvent({ type: 'TOOL_CALL_END', toolCallId: 'toolu_mcp_1' });

      // Server sends the actual MCP tool result via TOOL_CALL_RESULT
      emitEvent({
        type: 'TOOL_CALL_RESULT',
        messageId: 'msg-result-1',
        toolCallId: 'toolu_mcp_1',
        content: '{"temperature":15,"condition":"cloudy"}',
        role: 'tool',
      });

      // STEP_FINISHED flushes the tool-call step (assistant(toolCalls) + result).
      emitEvent({ type: 'STEP_FINISHED' });

      // Server sends final text response
      emitEvent({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
      emitEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'It is 15°C and cloudy in Tokyo.' });
      emitEvent({ type: 'TEXT_MESSAGE_END', messageId: 'msg-1' });
      emitEvent({ type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' });

      const messages = client.messages;
      expect(messages).toHaveLength(4); // user, assistant(toolCalls), tool, assistant(text)

      const toolResult = messages[2];
      expect(toolResult.role).toBe('tool');
      expect(toolResult.content).toBe('{"temperature":15,"condition":"cloudy"}');
      expect((toolResult as Record<string, unknown>).toolCallId).toBe('toolu_mcp_1');
    });

    test('TOOL_CALL_RESULT does not duplicate result for client-side tools', async () => {
      await harness.open();

      client.sendPrompt('Add a todo: buy groceries');

      emitEvent({ type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' });
      emitEvent({ type: 'TOOL_CALL_START', toolCallId: 'toolu_client_1', toolCallName: 'addTodo' });
      emitEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 'toolu_client_1', delta: '{"text":"buy groceries"}' });
      emitEvent({ type: 'TOOL_CALL_END', toolCallId: 'toolu_client_1' });

      // Client executes tool and sends result (this pushes to _pendingToolResults)
      client.sendToolResponse('toolu_client_1', { success: true });

      // Server also sends TOOL_CALL_RESULT for the same toolCallId (should be deduplicated)
      emitEvent({
        type: 'TOOL_CALL_RESULT',
        messageId: 'msg-result-dup',
        toolCallId: 'toolu_client_1',
        content: '{"success":true}',
        role: 'tool',
      });

      // STEP_FINISHED flushes the tool-call step (assistant(toolCalls) + result).
      emitEvent({ type: 'STEP_FINISHED' });

      emitEvent({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
      emitEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Done!' });
      emitEvent({ type: 'TEXT_MESSAGE_END', messageId: 'msg-1' });
      emitEvent({ type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' });

      const messages = client.messages;
      const toolResults = messages.filter(m => m.role === 'tool');
      expect(toolResults).toHaveLength(1); // Only one, not duplicated
    });

    test('abortRun sends abort_run with the in-flight runId from sendPrompt', async () => {
      await harness.open();

      client.sendPrompt('Hello');
      const runId = client.currentRunId;
      expect(typeof runId).toBe('string');

      client.abortRun();

      expect(lastSent()).toEqual({ type: 'abort_run', data: { runId } });
    });

    test('abortRun is a no-op when no run is in flight', async () => {
      await harness.open();

      client.abortRun();

      expect(harness.sent()).toEqual([]);
    });

    test('currentRunId is cleared after RUN_FINISHED', async () => {
      await harness.open();

      client.sendPrompt('Hello');
      expect(client.currentRunId).not.toBeNull();

      emitEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      emitEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm' });
      emitEvent({ type: 'TEXT_MESSAGE_END', messageId: 'm' });
      emitEvent({ type: 'RUN_FINISHED', threadId: 't', runId: 'r' });

      expect(client.currentRunId).toBeNull();
    });

    test('currentRunId is cleared after RUN_ERROR', async () => {
      await harness.open();

      client.sendPrompt('Hello');
      expect(client.currentRunId).not.toBeNull();

      emitEvent({ type: 'RUN_ERROR', message: 'ABORTED' });

      expect(client.currentRunId).toBeNull();
    });

    test('stopping while a tool is still running backfills results for the unanswered tool calls', async () => {
      await harness.open();

      client.sendPrompt('Add two todos');

      emitEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      // Two tool_use blocks streamed, but the client never responds for the
      // second one (aborted mid-execution).
      emitEvent({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'addTodo' });
      emitEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"text":"a"}' });
      emitEvent({ type: 'TOOL_CALL_END', toolCallId: 'tc1' });
      emitEvent({ type: 'TOOL_CALL_START', toolCallId: 'tc2', toolCallName: 'addTodo' });
      emitEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc2', delta: '{"text":"b"}' });
      emitEvent({ type: 'TOOL_CALL_END', toolCallId: 'tc2' });

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

    test('stopping mid-TOOL_CALL_ARGS (before TOOL_CALL_END) leaves no orphaned tool_use in history', async () => {
      await harness.open();

      client.sendPrompt('Add a todo');

      emitEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      emitEvent({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'addTodo' });
      // Partial args delta — TOOL_CALL_END never arrives before abort.
      emitEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"text":"buy' });

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

    test('does not duplicate the step text in _messages after a STEP_FINISHED → ABORT sequence', async () => {
      // Regression: aborting between STEP_FINISHED and the next TEXT_MESSAGE_START used to save the step text twice.
      await harness.open();

      client.sendPrompt('test prompt');

      emitEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      emitEvent({ type: 'STEP_STARTED', stepName: 'step-0' });
      emitEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1' });
      emitEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'step text' });
      emitEvent({ type: 'TEXT_MESSAGE_END', messageId: 'm1' });
      emitEvent({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'testTool' });
      emitEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{}' });
      emitEvent({ type: 'TOOL_CALL_END', toolCallId: 'tc1' });
      emitEvent({ type: 'TOOL_CALL_RESULT', messageId: 'tr1', toolCallId: 'tc1', content: '[]', role: 'tool' });
      emitEvent({ type: 'STEP_FINISHED', stepName: 'step-0' });

      client.finalizeRun({ aborted: true });

      const textMatches = (client.messages as Array<Record<string, unknown>>).filter(
        m => m.role === 'assistant' && m.content === 'step text',
      );
      expect(textMatches).toHaveLength(1);
      expect(textMatches[0].toolCalls).toBeDefined();
      expect((textMatches[0].toolCalls as Array<{ id: string }>)[0].id).toBe('tc1');
    });

    test("a tool-only aborted run does not leak the previous run's text", async () => {
      await harness.open();

      // Run 1: ends with a final text answer.
      client.sendPrompt('list the tools');
      emitEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r1' });
      emitEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1' });
      emitEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Here are the tools' });
      emitEvent({ type: 'TEXT_MESSAGE_END', messageId: 'm1' });
      emitEvent({ type: 'RUN_FINISHED', threadId: 't', runId: 'r1' });

      // Run 2: tool-only step (no TEXT_MESSAGE_START), aborted mid-execution.
      // RUN_STARTED must reset the leftover text so it is not persisted again.
      client.sendPrompt('wait 5 seconds');
      emitEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r2' });
      expect(client.currentMessageContent).toBe('');

      emitEvent({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'wait' });
      emitEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"seconds":5}' });
      emitEvent({ type: 'TOOL_CALL_END', toolCallId: 'tc1' });
      client.finalizeRun({ aborted: true });

      // No assistant message carries the run-1 text after run 2's abort.
      const leaked = client.messages.filter(
        m => m.role === 'assistant' && m.content === 'Here are the tools' && !(m as Record<string, unknown>).toolCalls,
      );
      expect(leaked).toHaveLength(1); // only the legitimate run-1 message
    });

    test('stopping while the assistant is streaming text keeps the partial text', async () => {
      await harness.open();

      client.sendPrompt('Tell me a story');

      emitEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' });
      emitEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm' });
      emitEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'Once upon a' });
      // Note: no TEXT_MESSAGE_END — mid-stream abort.

      client.finalizeRun({ aborted: true });

      const msgs = client.messages;
      expect(msgs).toHaveLength(2);
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].content).toBe('Once upon a');
    });

    test("stopping while the assistant is reasoning drops the unfinished thinking but keeps earlier steps' reasoning", async () => {
      await harness.open();

      client.sendPrompt('Do two things');

      emitEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' });

      // Step 1: complete reasoning + tool_use + STEP_FINISHED. Reasoning gets
      // attached to the step-1 assistant message and survives the abort.
      emitEvent({ type: 'REASONING_MESSAGE_START', messageId: 'rm1' });
      emitEvent({ type: 'REASONING_MESSAGE_CONTENT', messageId: 'rm1', delta: 'think 1' });
      emitEvent({ type: 'REASONING_MESSAGE_END', messageId: 'rm1' });
      emitEvent({ type: 'REASONING_ENCRYPTED_VALUE', subtype: 'message', encryptedValue: 'sig1' });
      emitEvent({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'doThing' });
      emitEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{}' });
      emitEvent({ type: 'TOOL_CALL_END', toolCallId: 'tc1' });
      client.sendToolResponse('tc1', { ok: 1 });
      emitEvent({ type: 'STEP_FINISHED' });

      // Step 2: reasoning streamed but END/encrypted not received before abort.
      emitEvent({ type: 'REASONING_MESSAGE_START', messageId: 'rm2' });
      emitEvent({ type: 'REASONING_MESSAGE_CONTENT', messageId: 'rm2', delta: 'think 2 partial' });
      emitEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm2' });
      emitEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'About to' });

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

    test('simple text response (no tool calls) still works', async () => {
      await harness.open();

      client.sendPrompt('Hello');

      emitEvent({ type: 'RUN_STARTED', threadId: 'thread-1', runId: 'run-1' });
      emitEvent({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
      emitEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Hi there!' });
      emitEvent({ type: 'TEXT_MESSAGE_END', messageId: 'msg-1' });
      emitEvent({ type: 'RUN_FINISHED', threadId: 'thread-1', runId: 'run-1' });

      const messages = client.messages;
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('Hi there!');
    });
  });
});

describe('UseAIClient construction', () => {
  test('a server URL builds a Socket.IO transport', () => {
    const client = new UseAIClient('http://localhost:8081');
    client.connect();

    expect(sio.socket).toBeDefined();
    expect(client.isConnected()).toBe(false);

    sio.socket.connected = true;
    expect(client.isConnected()).toBe(true);

    client.disconnect();
  });

  test('disconnect() unsubscribes from the transport', async () => {
    FakeWebSocket.reset();
    const client = new UseAIClient(
      new WebSocketTransport('wss://localhost:8081', { WebSocket: FakeWebSocketConstructor }),
    );
    const stateChanges: boolean[] = [];
    client.onConnectionStateChange(connected => stateChanges.push(connected));
    client.connect();
    await waitUntil(() => FakeWebSocket.latest !== undefined);
    const socket = FakeWebSocket.latest!;
    socket.serverOpen();

    client.disconnect();
    // The transport is closed, but a late frame from the old socket must not
    // reach a client that has stopped listening.
    socket.serverClose();

    expect(stateChanges).toEqual([false, true]);
  });
});
