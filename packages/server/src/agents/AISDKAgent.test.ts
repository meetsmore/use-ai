import { describe, expect, test, mock } from 'bun:test';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput, EventEmitter, AGUIEventExtended } from './types';
import { EventType, ErrorCode } from '../types';
import type { ToolDefinition } from '../types';
import type { RemoteToolDefinition } from '../mcp';
import { v4 as uuidv4 } from 'uuid';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import {
  isRemoteTool,
  createGlobFilter,
  and,
  or,
  not,
} from '../utils/toolFilters';
import { pushTraceIdForRun, popTraceIdForRun } from '../instrumentation';

/**
 * Helper to create a streaming mock model that emits text
 * Note: Model-level chunks use 'delta' for text-delta, not 'text'
 * The streamText function transforms these to 'text' in the public API
 */
function createStreamingTextMockModel(text: string) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: text },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: 'stop' as const,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          },
        ],
      }),
      response: {
        id: 'response-1',
        timestamp: new Date(),
        modelId: 'mock-model',
        headers: {},
        messages: [
          { role: 'assistant', content: text },
        ],
      },
    }),
  });
}

/**
 * Helper to create a streaming mock model with multiple text deltas
 * Note: Model-level chunks use 'delta' for text-delta, not 'text'
 */
function createMultiDeltaStreamingMockModel(deltas: string[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          ...deltas.map(d => ({ type: 'text-delta' as const, id: 'text-1', delta: d })),
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: 'stop' as const,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          },
        ],
      }),
      response: {
        id: 'response-1',
        timestamp: new Date(),
        modelId: 'mock-model',
        headers: {},
        messages: [
          { role: 'assistant', content: deltas.join('') },
        ],
      },
    }),
  });
}

/**
 * Helper to create a standard test input
 */
function createTestInput(overrides: Partial<AgentInput> = {}): AgentInput {
  const threadId = uuidv4();
  const runId = uuidv4();
  return {
    session: {
      socket: {} as never,
      clientId: 'client-1',
      threadId: 'thread-1',
      tools: [],
      state: null,
      pendingToolCalls: new Map(),
      pendingToolApprovals: new Map(),
      ipAddress: '127.0.0.1',
    },
    runId,
    messages: [
      { role: 'user', content: 'Hello' },
    ],
    tools: [],
    state: null,
    originalInput: {
      threadId,
      runId,
      messages: [{ id: uuidv4(), role: 'user', content: 'Hello' }],
      tools: [],
      state: null,
      context: [],
      forwardedProps: {},
    },
    ...overrides,
  };
}

describe('AISDKAgent', () => {
  test('implements Agent interface', () => {
    const mockModel = createStreamingTextMockModel('Default response');
    const agent = new AISDKAgent({ model: mockModel });

    expect(agent.getName()).toBe('ai-sdk');
    expect(typeof agent.run).toBe('function');
  });

  test('getName returns custom name when provided', () => {
    const mockModel = createStreamingTextMockModel('Default response');
    const agent = new AISDKAgent({ model: mockModel, name: 'claude' });

    expect(agent.getName()).toBe('claude');
  });

  test('run emits RUN_STARTED event', async () => {
    const mockModel = createStreamingTextMockModel('Hello');
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    await agent.run(input, eventEmitter);

    const runStartedEvent = emittedEvents.find(e => e.type === EventType.RUN_STARTED);
    expect(runStartedEvent).toBeDefined();
    expect((runStartedEvent as { runId: string }).runId).toBe(input.runId);
  });

  test('run emits TEXT_MESSAGE events for text response', async () => {
    const mockModel = createStreamingTextMockModel('Hello world');
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    await agent.run(input, eventEmitter);

    const textStart = emittedEvents.find(e => e.type === EventType.TEXT_MESSAGE_START);
    const textContent = emittedEvents.find(e => e.type === EventType.TEXT_MESSAGE_CONTENT);
    const textEnd = emittedEvents.find(e => e.type === EventType.TEXT_MESSAGE_END);

    expect(textStart).toBeDefined();
    expect(textContent).toBeDefined();
    expect(textEnd).toBeDefined();
    expect((textContent as { delta: string }).delta).toBe('Hello world');
  });

  test('run emits multiple TEXT_MESSAGE_CONTENT events for streaming deltas', async () => {
    const mockModel = createMultiDeltaStreamingMockModel(['Hello ', 'world', '!']);
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    await agent.run(input, eventEmitter);

    const textContentEvents = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_CONTENT);

    expect(textContentEvents.length).toBe(3);
    expect((textContentEvents[0] as { delta: string }).delta).toBe('Hello ');
    expect((textContentEvents[1] as { delta: string }).delta).toBe('world');
    expect((textContentEvents[2] as { delta: string }).delta).toBe('!');
  });

  test('run emits RUN_FINISHED event on success', async () => {
    const mockModel = createStreamingTextMockModel('Done');
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    const result = await agent.run(input, eventEmitter);

    expect(result.success).toBe(true);
    const runFinishedEvent = emittedEvents.find(e => e.type === EventType.RUN_FINISHED);
    expect(runFinishedEvent).toBeDefined();
  });

  test('run emits RUN_ERROR event on failure', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error('API Error');
      },
    });

    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    const result = await agent.run(input, eventEmitter);

    expect(result.success).toBe(false);
    expect(result.error).toBe('API Error');

    const runErrorEvent = emittedEvents.find(e => e.type === EventType.RUN_ERROR);
    expect(runErrorEvent).toBeDefined();
    expect((runErrorEvent as { message: string }).message).toBe(ErrorCode.UNKNOWN_ERROR);
  });

  test('run emits TOOL_CALL events when AI uses tools', async () => {
    const toolCallId = 'tool-call-123';
    const mockModel = new MockLanguageModelV3({
      doStream: async ({ tools }) => {
        // Check if tools are provided and create tool call stream
        const hasTools = tools && Object.keys(tools).length > 0;

        if (hasTools) {
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'tool-input-start', id: toolCallId, toolName: 'test_tool' },
                { type: 'tool-input-delta', id: toolCallId, delta: '{"value":' },
                { type: 'tool-input-delta', id: toolCallId, delta: '"test"}' },
                { type: 'tool-input-end', id: toolCallId },
                { type: 'tool-call', toolCallId, toolName: 'test_tool', input: '{"value":"test"}' },
                {
                  type: 'finish',
                  finishReason: 'tool-calls',
                  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
              ],
            }),
            response: {
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool-call',
                      toolCallId,
                      toolName: 'test_tool',
                      input: { value: 'test' },
                    },
                  ],
                },
              ],
            },
          };
        }

        // Default text response
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Done' },
              { type: 'text-end', id: 'text-1' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [{ role: 'assistant', content: 'Done' }],
          },
        };
      },
    });

    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => {
        emittedEvents.push(event);
      },
    };

    const input = createTestInput({
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              value: { type: 'string' },
            },
            required: ['value'],
          },
        },
      ],
    });

    // Start run in background
    const runPromise = agent.run(input, eventEmitter);

    // Wait for TOOL_CALL_END event and provide result
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const toolCallEnd = emittedEvents.find(e => e.type === EventType.TOOL_CALL_END);
        if (toolCallEnd) {
          clearInterval(checkInterval);

          // Simulate client sending tool result
          const receivedToolCallId = (toolCallEnd as { toolCallId: string }).toolCallId;
          const resolver = input.session.pendingToolCalls.get(receivedToolCallId);
          if (resolver) {
            resolver(JSON.stringify({ success: true }));
          }

          resolve();
        }
      }, 10);

      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    });

    // Verify tool call events were emitted
    const toolCallStart = emittedEvents.find(e => e.type === EventType.TOOL_CALL_START);
    const toolCallArgsEvents = emittedEvents.filter(e => e.type === EventType.TOOL_CALL_ARGS);
    const toolCallEnd = emittedEvents.find(e => e.type === EventType.TOOL_CALL_END);

    expect(toolCallStart).toBeDefined();
    expect((toolCallStart as { toolCallName: string }).toolCallName).toBe('test_tool');

    // Should have streamed args in deltas
    expect(toolCallArgsEvents.length).toBe(2);
    expect((toolCallArgsEvents[0] as { delta: string }).delta).toBe('{"value":');
    expect((toolCallArgsEvents[1] as { delta: string }).delta).toBe('"test"}');

    expect(toolCallEnd).toBeDefined();
  });

  test('run emits TOOL_CALL_ARGS when no streaming args (empty input tool)', async () => {
    // This test covers the fix for tools with no arguments where AI SDK skips
    // tool-input-delta events entirely. The agent should still emit TOOL_CALL_ARGS
    // with the complete args (empty object) when the tool-call event arrives.
    const toolCallId = 'tool-call-empty-args';
    let callCount = 0;
    const mockModel = new MockLanguageModelV3({
      doStream: async () => {
        callCount++;

        // First call: return tool call without streaming args
        if (callCount === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                // Note: No tool-input-delta events - AI SDK skips streaming for empty args
                { type: 'tool-input-start', id: toolCallId, toolName: 'logout_tool' },
                { type: 'tool-input-end', id: toolCallId },
                // AI SDK tool-call chunk has input as string (JSON stringified)
                // See LanguageModelV3ToolCall type in @ai-sdk/provider
                { type: 'tool-call', toolCallId, toolName: 'logout_tool', input: '{}' },
                {
                  type: 'finish',
                  finishReason: 'tool-calls',
                  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
              ],
            }),
            response: {
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool-call',
                      toolCallId,
                      toolName: 'logout_tool',
                      input: {},
                    },
                  ],
                },
              ],
            },
          };
        }

        // Subsequent calls: return text response to complete the run
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Logged out successfully' },
              { type: 'text-end', id: 'text-1' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [{ role: 'assistant', content: 'Logged out successfully' }],
          },
        };
      },
    });

    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => {
        emittedEvents.push(event);
      },
    };

    const input = createTestInput({
      tools: [
        {
          name: 'logout_tool',
          description: 'Log the user out (no arguments)',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ],
    });

    // Start run in background
    const runPromise = agent.run(input, eventEmitter);

    // Wait for TOOL_CALL_END event and provide result
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const toolCallEnd = emittedEvents.find(e => e.type === EventType.TOOL_CALL_END);
        if (toolCallEnd) {
          clearInterval(checkInterval);

          // Simulate client sending tool result
          const receivedToolCallId = (toolCallEnd as { toolCallId: string }).toolCallId;
          const resolver = input.session.pendingToolCalls.get(receivedToolCallId);
          if (resolver) {
            resolver(JSON.stringify({ success: true, message: 'Logged out' }));
          }

          resolve();
        }
      }, 10);

      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000);
    });

    await runPromise;

    // Verify tool call events were emitted
    const toolCallStart = emittedEvents.find(e => e.type === EventType.TOOL_CALL_START);
    const toolCallArgsEvents = emittedEvents.filter(e => e.type === EventType.TOOL_CALL_ARGS);
    const toolCallEnd = emittedEvents.find(e => e.type === EventType.TOOL_CALL_END);

    expect(toolCallStart).toBeDefined();
    expect((toolCallStart as { toolCallName: string }).toolCallName).toBe('logout_tool');

    // Even though no tool-input-delta was streamed, we should still get one TOOL_CALL_ARGS
    // event with the complete args (empty object in this case)
    expect(toolCallArgsEvents.length).toBe(1);
    expect((toolCallArgsEvents[0] as { delta: string }).delta).toBe('{}');

    expect(toolCallEnd).toBeDefined();
  });

  test('agent updates conversation history', async () => {
    const mockModel = createStreamingTextMockModel('Response text');
    const agent = new AISDKAgent({ model: mockModel });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const session = {
      socket: {} as never,
      clientId: 'client-1',
      threadId: 'thread-1',
      tools: [] as never[],
      state: null,
      pendingToolCalls: new Map<string, (content: string) => void>(),
      ipAddress: '127.0.0.1',
    };

    const input = createTestInput({ session: session as never });
    const result = await agent.run(input, eventEmitter);

    expect(result.success).toBe(true);
    expect(result.conversationHistory).toBeDefined();

    // Verify result conversationHistory includes input + at least the assistant response
    expect(result.conversationHistory.length).toBeGreaterThanOrEqual(2);
  });

  describe('Conversation history edge cases', () => {
    test('with stopWhen: response excludes input messages', async () => {
      // This test covers the case where AI SDK returns only NEW messages (not including input)
      // This is the typical behavior with stopWhen

      // Mock streamText to control response.messages
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: (options: unknown) => {
          // Create a mock stream result
          const mockResult = {
            fullStream: (async function* () {
              yield { type: 'text-start', id: 'text-1' };
              yield { type: 'text-delta', id: 'text-1', text: 'Final response after tool execution' };
              yield { type: 'text-end', id: 'text-1' };
              yield {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
              };
            })(),
            response: Promise.resolve({
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [
                // Only NEW messages (not including input)
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool-call',
                      toolCallId: 'call-123',
                      toolName: 'test_tool',
                      input: { value: 'test' },
                    },
                  ],
                },
                {
                  role: 'tool',
                  content: [
                    {
                      type: 'tool-result',
                      toolCallId: 'call-123',
                      toolName: 'test_tool',
                      output: { success: true },
                    },
                  ],
                },
                {
                  role: 'assistant',
                  content: 'Final response after tool execution',
                },
              ],
            }),
          };
          return mockResult;
        },
      }));

      const mockModel = createStreamingTextMockModel('Final response after tool execution');
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const session = {
        socket: {} as never,
        clientId: 'client-1',
        threadId: 'thread-1',
        tools: [] as never[],
        state: null,
        pendingToolCalls: new Map<string, (content: string) => void>(),
          ipAddress: '127.0.0.1',
      };

      const input = createTestInput({ session: session as never });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);

      // result.conversationHistory = input messages + 3 new response messages
      // Input: [user 'Hello'], Response: [assistant(tool-call), tool(result), assistant(text)]
      expect(result.conversationHistory.length).toBe(4);
      expect((result.conversationHistory[0] as { role: string }).role).toBe('user');
      expect((result.conversationHistory[1] as { role: string }).role).toBe('assistant');
      expect((result.conversationHistory[2] as { role: string }).role).toBe('tool');
      expect((result.conversationHistory[3] as { role: string }).role).toBe('assistant');

      // Verify the messages were sanitized (no extra fields)
      const assistantMsg = result.conversationHistory[1] as { content: unknown };
      expect(assistantMsg.content).toBeDefined();
      expect(Array.isArray(assistantMsg.content)).toBe(true);

      // Restore original
      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('with single step: response includes input messages', async () => {
      // This test covers the case where AI SDK returns ALL messages (including input)
      // This may happen with single step or certain AI SDK versions

      // Mock streamText to return response that includes the input message
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: (options: unknown) => {
          const mockResult = {
            fullStream: (async function* () {
              yield { type: 'text-start', id: 'text-1' };
              yield { type: 'text-delta', id: 'text-1', text: 'Final response after tool execution' };
              yield { type: 'text-end', id: 'text-1' };
              yield {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
              };
            })(),
            response: Promise.resolve({
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [
                // Input message included - this is the key difference
                {
                  role: 'user',
                  content: 'Hello',
                },
                {
                  role: 'assistant',
                  content: [
                    {
                      type: 'tool-call',
                      toolCallId: 'call-456',
                      toolName: 'test_tool',
                      input: { value: 'test' },
                    },
                  ],
                },
                {
                  role: 'tool',
                  content: [
                    {
                      type: 'tool-result',
                      toolCallId: 'call-456',
                      toolName: 'test_tool',
                      output: { success: true },
                    },
                  ],
                },
                {
                  role: 'assistant',
                  content: 'Final response after tool execution',
                },
              ],
            }),
          };
          return mockResult;
        },
      }));

      const mockModel = createStreamingTextMockModel('Final response after tool execution');
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const session = {
        socket: {} as never,
        clientId: 'client-1',
        threadId: 'thread-1',
        tools: [] as never[],
        state: null,
        pendingToolCalls: new Map<string, (content: string) => void>(),
          ipAddress: '127.0.0.1',
      };

      const input = createTestInput({ session: session as never });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);

      // result.conversationHistory = input messages + response messages
      // When response includes input, allResponseMessages has duplicates.
      // Input: [user], Response: [user, assistant, tool, assistant]
      // Result: input + allResponseMessages = [user] + [user, assistant, tool, assistant] = 5
      expect(result.conversationHistory.length).toBe(5);
      expect((result.conversationHistory[0] as { role: string }).role).toBe('user');
      // Response messages appended after input
      expect((result.conversationHistory[1] as { role: string }).role).toBe('user');
      expect((result.conversationHistory[2] as { role: string }).role).toBe('assistant');
      expect((result.conversationHistory[3] as { role: string }).role).toBe('tool');
      expect((result.conversationHistory[4] as { role: string }).role).toBe('assistant');

      // Restore original
      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('preserves existing history across multiple turns', async () => {
      // This test verifies that conversation history accumulates correctly across multiple turns

      // Mock streamText to return a simple response with one assistant message
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: (options: unknown) => {
          const mockResult = {
            fullStream: (async function* () {
              yield { type: 'text-start', id: 'text-1' };
              yield { type: 'text-delta', id: 'text-1', text: 'Response' };
              yield { type: 'text-end', id: 'text-1' };
              yield {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
              };
            })(),
            response: Promise.resolve({
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [
                {
                  role: 'assistant',
                  content: 'Response',
                },
              ],
            }),
          };
          return mockResult;
        },
      }));

      const mockModel = createStreamingTextMockModel('Response');
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const session = {
        socket: {} as never,
        clientId: 'client-1',
        threadId: 'thread-1',
        tools: [] as never[],
        state: null,
        pendingToolCalls: new Map<string, (content: string) => void>(),
        ipAddress: '127.0.0.1',
      };

      const input = createTestInput({
        session: session as never,
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
      });

      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);

      // result.conversationHistory = input messages + response messages
      // Input: [user, assistant, user], Response: [assistant('Response')]
      expect(result.conversationHistory.length).toBe(4);
      expect((result.conversationHistory[0] as { content: string }).content).toBe('First message');
      expect((result.conversationHistory[1] as { content: string }).content).toBe('First response');
      expect((result.conversationHistory[2] as { content: string }).content).toBe('Second message');
      expect((result.conversationHistory[3] as { content: string }).content).toBe('Response');

      // Restore original
      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('multi-step execution preserves all step messages in history', async () => {
      // This test verifies that when multiple steps occur (tool calls trigger re-invocation),
      // messages from ALL steps are preserved in conversation history, not just the last step.
      // Regression test for: response.messages only containing the last step's messages.

      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;
      let callCount = 0;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: (options: unknown) => {
          callCount++;

          if (callCount === 1) {
            // Step 0: Model makes a tool call
            return {
              fullStream: (async function* () {
                yield { type: 'tool-input-start', id: 'call-1', toolName: 'test_tool' };
                yield { type: 'tool-input-delta', id: 'call-1', delta: '{"value":"test"}' };
                yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'test_tool', input: { value: 'test' } };
                yield { type: 'tool-result', toolCallId: 'call-1', toolName: 'test_tool', output: { success: true } };
                yield {
                  type: 'finish',
                  finishReason: 'stop',
                  usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
                };
              })(),
              response: Promise.resolve({
                id: 'response-step-0',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [
                  {
                    role: 'assistant',
                    content: [
                      {
                        type: 'tool-call',
                        toolCallId: 'call-1',
                        toolName: 'test_tool',
                        input: { value: 'test' },
                      },
                    ],
                  },
                  {
                    role: 'tool',
                    content: [
                      {
                        type: 'tool-result',
                        toolCallId: 'call-1',
                        toolName: 'test_tool',
                        output: { success: true },
                      },
                    ],
                  },
                ],
              }),
            };
          } else {
            // Step 1: Model returns final text response
            return {
              fullStream: (async function* () {
                yield { type: 'text-start', id: 'text-1' };
                yield { type: 'text-delta', id: 'text-1', text: 'Done! Tool executed successfully.' };
                yield { type: 'text-end', id: 'text-1' };
                yield {
                  type: 'finish',
                  finishReason: 'stop',
                  usage: { inputTokens: 80, outputTokens: 30, totalTokens: 110 },
                };
              })(),
              response: Promise.resolve({
                id: 'response-step-1',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [
                  {
                    role: 'assistant',
                    content: 'Done! Tool executed successfully.',
                  },
                ],
              }),
            };
          }
        },
      }));

      const mockModel = createStreamingTextMockModel('unused');
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const testTool: ToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: { value: { type: 'string' } } },
      };

      const session = {
        socket: {} as never,
        clientId: 'client-1',
        threadId: 'thread-1',
        tools: [testTool] as never[],
        state: null,
        pendingToolCalls: new Map<string, (content: string) => void>(),
          ipAddress: '127.0.0.1',
      };

      const input = createTestInput({ session: session as never, tools: [testTool] as never[] });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);

      // result.conversationHistory = input messages + all response messages from both steps
      // Input: [user 'Hello'], Response: [assistant(tool-call), tool(result), assistant(text)]
      expect(result.conversationHistory.length).toBe(4);
      expect((result.conversationHistory[0] as { role: string }).role).toBe('user');
      expect((result.conversationHistory[1] as { role: string }).role).toBe('assistant');
      expect((result.conversationHistory[2] as { role: string }).role).toBe('tool');
      expect((result.conversationHistory[3] as { role: string }).role).toBe('assistant');
      expect((result.conversationHistory[3] as { content: string }).content).toBe('Done! Tool executed successfully.');

      // Verify streamText was called twice (two steps)
      expect(callCount).toBe(2);

      // Restore original
      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });
  });

  describe('Streaming-specific tests', () => {
    test('emits STEP_STARTED and STEP_FINISHED events', async () => {
      // Note: Model-level chunks don't have 'start-step'/'finish-step' - those are emitted by streamText
      // We need to use the model-level chunk format with 'stream-start'
      const mockModel = new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Hello' },
              { type: 'text-end', id: 'text-1' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
              },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [{ role: 'assistant', content: 'Hello' }],
          },
        }),
      });

      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const input = createTestInput();
      await agent.run(input, eventEmitter);

      const stepStarted = emittedEvents.find(e => e.type === EventType.STEP_STARTED);
      const stepFinished = emittedEvents.find(e => e.type === EventType.STEP_FINISHED);

      expect(stepStarted).toBeDefined();
      expect((stepStarted as { stepName: string }).stepName).toBe('step-0');

      expect(stepFinished).toBeDefined();
      expect((stepFinished as { stepName: string }).stepName).toBe('step-0');
    });

    test('handles error chunk in stream', async () => {
      const mockModel = new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 'text-1' },
              { type: 'error', error: new Error('Stream error') },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [],
          },
        }),
      });

      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stream error');

      const runErrorEvent = emittedEvents.find(e => e.type === EventType.RUN_ERROR);
      expect(runErrorEvent).toBeDefined();
    });

    test('handles empty response (no text, no tool calls)', async () => {
      const mockModel = new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
              },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [],
          },
        }),
      });

      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty response from AI');

      const runErrorEvent = emittedEvents.find(e => e.type === EventType.RUN_ERROR);
      expect(runErrorEvent).toBeDefined();
      expect((runErrorEvent as { message: string }).message).toContain('empty response');
    });
  });

  describe('System prompt configuration', () => {
    /**
     * Helper to create a mock model that captures the system messages passed to it
     */
    function createSystemMessageCapturingMockModel(capturedMessages: { values: Array<{ role: string; content: string }> }) {
      return new MockLanguageModelV3({
        doStream: async ({ prompt }) => {
          // Find all system messages in the prompt
          // System messages have content as string, so we can safely cast
          const systemMessages = prompt.filter((msg) => msg.role === 'system') as Array<{ role: string; content: string }>;
          capturedMessages.values = systemMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          }));

          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-start', id: 'text-1' },
                { type: 'text-delta', id: 'text-1', delta: 'Done' },
                { type: 'text-end', id: 'text-1' },
                { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              ],
            }),
            response: {
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [{ role: 'assistant', content: 'Done' }],
            },
          };
        },
      });
    }

    test('uses config systemPrompt when provided', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: 'You are a helpful assistant.',
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('You are a helpful assistant.');
    });

    test('sends config, runtime instructions, and state as separate system messages', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: 'You are a helpful assistant.',
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const testState = { todos: [] };
      const input = createTestInput({
        systemPrompt: 'Use tools to modify the UI.',
        state: testState,
      });
      // Also set session.state so buildStateMessage picks it up
      input.session.state = testState;
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      // Config prompt, runtime instructions, and state are sent as 3 separate system messages
      expect(capturedMessages.values.length).toBe(3);
      expect(capturedMessages.values[0].role).toBe('system');
      expect(capturedMessages.values[0].content).toBe('You are a helpful assistant.');
      expect(capturedMessages.values[1].role).toBe('system');
      expect(capturedMessages.values[1].content).toBe('Use tools to modify the UI.');
      expect(capturedMessages.values[2].role).toBe('system');
      expect(capturedMessages.values[2].content).toContain('"todos": []');
    });

    test('uses only runtime systemPrompt and state when config is not set', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
        // No systemPrompt in config
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const testState = { page: '/home' };
      const input = createTestInput({
        systemPrompt: 'Use tools to modify the UI.',
        state: testState,
      });
      input.session.state = testState;
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      // Runtime instructions + state (no config prompt)
      expect(capturedMessages.values.length).toBe(2);
      expect(capturedMessages.values[0].content).toBe('Use tools to modify the UI.');
      expect(capturedMessages.values[1].content).toContain('/home');
    });

    test('no systemPrompt when both config and runtime are undefined', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      expect(capturedMessages.values.length).toBe(0);
    });

    test('supports function-based systemPrompt for dynamic resolution', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      // Simulate a dynamic prompt that could be fetched from Langfuse or other sources
      let dynamicPromptValue = 'Initial prompt';
      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: () => dynamicPromptValue,
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      // First run with initial prompt
      const input1 = createTestInput();
      await agent.run(input1, eventEmitter);

      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Initial prompt');

      // Update the dynamic prompt value (simulating Langfuse update)
      dynamicPromptValue = 'Updated prompt from Langfuse';

      // Second run should use the updated prompt without server restart
      const input2 = createTestInput();
      await agent.run(input2, eventEmitter);

      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Updated prompt from Langfuse');
    });

    test('function-based systemPrompt returning empty string is skipped', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: () => '',
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'Runtime prompt only',
      });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      // Only runtime prompt should be present since function returned empty string
      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Runtime prompt only');
    });

    test('supports async function-based systemPrompt', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      // Simulate fetching from Langfuse or other async source
      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: async () => {
          // Simulate async operation (e.g., Langfuse API call)
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'Async prompt from Langfuse';
        },
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Async prompt from Langfuse');
    });

    test('async systemPrompt is resolved fresh on each run', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      // Simulate a prompt that changes over time (like Langfuse updates)
      let promptVersion = 1;
      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return `Prompt version ${promptVersion}`;
        },
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      // First run
      await agent.run(createTestInput(), eventEmitter);
      expect(capturedMessages.values[0].content).toBe('Prompt version 1');

      // Update the prompt (simulating Langfuse update)
      promptVersion = 2;

      // Second run should get the updated prompt
      await agent.run(createTestInput(), eventEmitter);
      expect(capturedMessages.values[0].content).toBe('Prompt version 2');
    });

    test('async systemPrompt returning empty string is skipped', async () => {
      const capturedMessages = { values: [] as Array<{ role: string; content: string }> };
      const mockModel = createSystemMessageCapturingMockModel(capturedMessages);

      const agent = new AISDKAgent({
        model: mockModel,
        systemPrompt: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return '';
        },
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'Runtime prompt only',
      });
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(true);
      expect(capturedMessages.values.length).toBe(1);
      expect(capturedMessages.values[0].content).toBe('Runtime prompt only');
    });

    test('state message is rebuilt from session.state between steps', async () => {
      // Track all system messages sent in each step call
      const capturedPerStep: Array<Array<{ role: string; content: string }>> = [];
      const toolCallId = 'tool-call-state-test';
      let callCount = 0;

      const mockModel = new MockLanguageModelV3({
        doStream: async ({ prompt }) => {
          callCount++;
          // Capture system messages for this step
          const systemMessages = prompt
            .filter((msg) => msg.role === 'system')
            .map((msg) => ({ role: msg.role, content: msg.content as string }));
          capturedPerStep.push(systemMessages);

          // First call: return a tool call
          if (callCount === 1) {
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'tool-input-start', id: toolCallId, toolName: 'navigate' },
                  { type: 'tool-input-delta', id: toolCallId, delta: '{"page":"todo"}' },
                  { type: 'tool-input-end', id: toolCallId },
                  { type: 'tool-call', toolCallId, toolName: 'navigate', input: '{"page":"todo"}' },
                  {
                    type: 'finish',
                    finishReason: 'tool-calls',
                    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                  },
                ],
              }),
              response: {
                id: 'response-1',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [
                  {
                    role: 'assistant',
                    content: [
                      { type: 'tool-call', toolCallId, toolName: 'navigate', input: { page: 'todo' } },
                    ],
                  },
                ],
              },
            };
          }

          // Second call: return text response
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-start', id: 'text-1' },
                { type: 'text-delta', id: 'text-1', delta: 'Navigated to todo page' },
                { type: 'text-end', id: 'text-1' },
                {
                  type: 'finish',
                  finishReason: 'stop',
                  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                },
              ],
            }),
            response: {
              id: 'response-2',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [{ role: 'assistant', content: 'Navigated to todo page' }],
            },
          };
        },
      });

      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const initialState = { currentPage: '/mcp-tools', todos: [] };
      const input = createTestInput({
        tools: [
          {
            name: 'navigate',
            description: 'Navigate to a page',
            parameters: {
              type: 'object',
              properties: { page: { type: 'string' } },
              required: ['page'],
            },
          },
        ],
        state: initialState,
        systemPrompt: 'You are interacting with a web application.',
      });
      input.session.state = initialState;

      // Start run in background
      const runPromise = agent.run(input, eventEmitter);

      // Wait for tool call and simulate state change on tool result
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          const toolCallEnd = emittedEvents.find(e => e.type === EventType.TOOL_CALL_END);
          if (toolCallEnd) {
            clearInterval(checkInterval);

            // Simulate navigation: update session.state (as server.handleToolResult does)
            input.session.state = { currentPage: '/todo', todos: ['Buy groceries'] };

            // Resolve the pending tool call
            const receivedToolCallId = (toolCallEnd as { toolCallId: string }).toolCallId;
            const resolver = input.session.pendingToolCalls.get(receivedToolCallId);
            if (resolver) {
              resolver(JSON.stringify({ success: true }));
            }
            resolve();
          }
        }, 10);

        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 5000);
      });

      await runPromise;

      // Verify we had 2 steps
      expect(capturedPerStep.length).toBe(2);

      // Step 1: state message should contain initial state
      const step1StateMsg = capturedPerStep[0].find(m => m.content.includes('currentPage'));
      expect(step1StateMsg).toBeDefined();
      expect(step1StateMsg!.content).toContain('/mcp-tools');

      // Step 2: state message should contain updated state (rebuilt from session.state)
      const step2StateMsg = capturedPerStep[1].find(m => m.content.includes('currentPage'));
      expect(step2StateMsg).toBeDefined();
      expect(step2StateMsg!.content).toContain('/todo');
      expect(step2StateMsg!.content).toContain('Buy groceries');

      // Static system messages should be identical across both steps
      const step1StaticMsgs = capturedPerStep[0].filter(m => !m.content.includes('currentPage'));
      const step2StaticMsgs = capturedPerStep[1].filter(m => !m.content.includes('currentPage'));
      expect(step1StaticMsgs).toEqual(step2StaticMsgs);
    });
  });

  describe('Tool filtering', () => {
    /**
     * Helper to create a mock MCP (remote) tool with the _remote property
     */
    function createMcpTool(name: string, description: string = `MCP tool: ${name}`): RemoteToolDefinition {
      return {
        name,
        description,
        parameters: { type: 'object', properties: {}, required: [] },
        _remote: {
          provider: {
            executeTool: mock(() => Promise.resolve({ success: true })),
          } as unknown as RemoteToolDefinition['_remote']['provider'],
          originalName: name,
        },
      };
    }

    /**
     * Helper to create a mock client tool (no _remote property)
     */
    function createClientTool(name: string, description: string = `Client tool: ${name}`): ToolDefinition {
      return {
        name,
        description,
        parameters: { type: 'object', properties: {}, required: [] },
      };
    }

    /**
     * Helper to create a mock model that captures the tool names passed to it
     */
    function createToolCapturingMockModel(capturedTools: { names: string[] }) {
      return new MockLanguageModelV3({
        doStream: async ({ tools }) => {
          // Capture tool names - tools is an object with tool definitions
          // The keys may be numeric indices, so we need to extract names from values
          if (tools) {
            capturedTools.names = Object.values(tools).map((t: { name?: string }) => t.name || 'unknown');
          }

          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-start', id: 'text-1' },
                { type: 'text-delta', id: 'text-1', delta: 'Done' },
                { type: 'text-end', id: 'text-1' },
                { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              ],
            }),
            response: {
              id: 'response-1',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [{ role: 'assistant', content: 'Done' }],
            },
          };
        },
      });
    }

    test('no filtering: all tools are included', async () => {
      const capturedTools = { names: [] as string[] };
      const mockModel = createToolCapturingMockModel(capturedTools);

      // No toolFilter specified
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [
          createMcpTool('db_query'),
          createMcpTool('admin_delete'),
          createClientTool('client_tool'),
        ],
      });

      const result = await agent.run(input, eventEmitter);
      expect(result.success).toBe(true);
      expect(capturedTools.names.sort()).toEqual(['admin_delete', 'client_tool', 'db_query']);
    });

    test('glob pattern filtering: only matching tools are included', async () => {
      const capturedTools = { names: [] as string[] };
      const mockModel = createToolCapturingMockModel(capturedTools);

      const agent = new AISDKAgent({
        model: mockModel,
        // Filter to only allow tools matching 'db_*' pattern
        toolFilter: createGlobFilter(['db_*']),
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [
          createMcpTool('db_query'),
          createMcpTool('db_read'),
          createMcpTool('admin_delete'),
          createMcpTool('file_write'),
          createClientTool('client_tool'),
        ],
      });

      const result = await agent.run(input, eventEmitter);
      expect(result.success).toBe(true);
      // Only db_* tools should be included (client_tool is also filtered out by glob)
      expect(capturedTools.names.sort()).toEqual(['db_query', 'db_read']);
    });

    test('and combinator: combining multiple conditions', async () => {
      const capturedTools = { names: [] as string[] };
      const mockModel = createToolCapturingMockModel(capturedTools);

      const agent = new AISDKAgent({
        model: mockModel,
        // Tools matching 'db_*' AND is MCP tool (exclude client tools)
        toolFilter: and(
          createGlobFilter(['db_*']),
          isRemoteTool
        ),
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [
          createMcpTool('db_query'),
          createMcpTool('db_read'),
          createMcpTool('admin_delete'),
          createClientTool('db_client_tool'),  // Matches glob but is not MCP
          createClientTool('client_tool'),
        ],
      });

      const result = await agent.run(input, eventEmitter);
      expect(result.success).toBe(true);
      // Only MCP tools matching db_* (client tools excluded by isRemoteTool condition)
      expect(capturedTools.names.sort()).toEqual(['db_query', 'db_read']);
    });

    test('or combinator: multiple glob patterns', async () => {
      const capturedTools = { names: [] as string[] };
      const mockModel = createToolCapturingMockModel(capturedTools);

      const agent = new AISDKAgent({
        model: mockModel,
        // Tools matching either 'db_*' OR 'file_*'
        toolFilter: or(
          createGlobFilter(['db_*']),
          createGlobFilter(['file_*'])
        ),
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [
          createMcpTool('db_query'),
          createMcpTool('file_read'),
          createMcpTool('file_write'),
          createMcpTool('admin_delete'),
          createClientTool('client_tool'),
        ],
      });

      const result = await agent.run(input, eventEmitter);
      expect(result.success).toBe(true);
      // Tools matching db_* OR file_* (client_tool excluded by glob filters)
      expect(capturedTools.names.sort()).toEqual(['db_query', 'file_read', 'file_write']);
    });

    test('not combinator: exclude matching patterns', async () => {
      const capturedTools = { names: [] as string[] };
      const mockModel = createToolCapturingMockModel(capturedTools);

      const agent = new AISDKAgent({
        model: mockModel,
        // Exclude tools matching 'admin_*' or 'delete_*'
        toolFilter: not(
          or(
            createGlobFilter(['admin_*']),
            createGlobFilter(['*_delete'])
          )
        ),
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [
          createMcpTool('db_query'),
          createMcpTool('db_read'),
          createMcpTool('db_delete'),
          createMcpTool('admin_restart'),
          createClientTool('client_tool'),
        ],
      });

      const result = await agent.run(input, eventEmitter);
      expect(result.success).toBe(true);
      // admin_* and *_delete excluded
      expect(capturedTools.names.sort()).toEqual(['client_tool', 'db_query', 'db_read']);
    });
  });

  describe('Prompt caching (cacheBreakpoint)', () => {
    /**
     * Helper to create a mock stream result with captured messages
     */
    function createMockStreamResult(capturedMessages: { messages: unknown[] }) {
      return (options: { messages: unknown[] }) => {
        capturedMessages.messages = options.messages;
        return {
          fullStream: (async function* () {
            yield { type: 'text-start', id: 'text-1' };
            yield { type: 'text-delta', id: 'text-1', text: 'Response' };
            yield { type: 'text-end', id: 'text-1' };
            yield {
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            };
          })(),
          response: Promise.resolve({
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'claude-3-5-sonnet-20241022',
            headers: {},
            messages: [{ role: 'assistant', content: 'Response' }],
          }),
        };
      };
    }

    /**
     * Helper to create a mock Anthropic model
     */
    function createAnthropicMockModel() {
      return new MockLanguageModelV3({
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022',
      });
    }

    /**
     * Helper to create a non-Anthropic mock model
     */
    function createNonAnthropicMockModel() {
      return new MockLanguageModelV3({
        provider: 'openai',
        modelId: 'gpt-4-turbo',
      });
    }

    test('no cacheBreakpoint: messages are not modified', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
      });

      await agent.run(input, eventEmitter);

      // Messages should not have providerOptions
      const hasProviderOptions = capturedMessages.messages.some(
        (msg: unknown) => (msg as { providerOptions?: unknown }).providerOptions
      );
      expect(hasProviderOptions).toBe(false);

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint with system OR isLast: common caching pattern', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        cacheBreakpoint: (msg) => msg.role === 'system' || msg.isLast,
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      await agent.run(input, eventEmitter);

      // Should have 4 messages: system + 3 user/assistant messages
      expect(capturedMessages.messages.length).toBe(4);

      // System and last message should have cache control
      const messagesWithCache = capturedMessages.messages.filter(
        (msg: unknown) => (msg as { providerOptions?: unknown }).providerOptions
      );
      expect(messagesWithCache.length).toBe(2);

      // Verify system message has cache control
      const systemMsg = capturedMessages.messages[0] as { role: string; providerOptions?: { anthropic?: { cacheControl?: { type: string } } } };
      expect(systemMsg.role).toBe('system');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');

      // Verify last message has cache control
      const lastMsg = capturedMessages.messages[3] as { role: string; providerOptions?: { anthropic?: { cacheControl?: { type: string } } } };
      expect(lastMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint receives correct context', async () => {
      const mockModel = createAnthropicMockModel();

      const receivedContexts: Array<{
        role: string;
        index: number;
        totalCount: number;
        isFirst: boolean;
        isLast: boolean;
      }> = [];

      const agent = new AISDKAgent({
        model: mockModel,
        cacheBreakpoint: (msg) => {
          receivedContexts.push({
            role: msg.role,
            index: msg.index,
            totalCount: msg.totalCount,
            isFirst: msg.isFirst,
            isLast: msg.isLast,
          });
          return false;
        },
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'System prompt',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
      });

      await agent.run(input, eventEmitter);

      // Should have received context for 3 messages
      expect(receivedContexts.length).toBe(3);

      // Verify system message context
      expect(receivedContexts[0]).toEqual({
        role: 'system',
        index: 0,
        totalCount: 3,
        isFirst: true,
        isLast: false,
      });

      // Verify user message context
      expect(receivedContexts[1]).toEqual({
        role: 'user',
        index: 1,
        totalCount: 3,
        isFirst: false,
        isLast: false,
      });

      // Verify assistant message context
      expect(receivedContexts[2]).toEqual({
        role: 'assistant',
        index: 2,
        totalCount: 3,
        isFirst: false,
        isLast: true,
      });
    });

    test('cacheBreakpoint not applied for non-Anthropic models', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createNonAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        // This would add cache control for Anthropic, but should be ignored for other models
        cacheBreakpoint: (msg) => msg.isLast,
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
      });

      await agent.run(input, eventEmitter);

      // No messages should have providerOptions since it's not an Anthropic model
      const hasProviderOptions = capturedMessages.messages.some(
        (msg: unknown) => (msg as { providerOptions?: unknown }).providerOptions
      );
      expect(hasProviderOptions).toBe(false);

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint with TTL string: adds cache control with explicit TTL', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        // Return '1h' TTL for system prompt
        cacheBreakpoint: (msg) => msg.role === 'system' ? '1h' : false,
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
      });

      await agent.run(input, eventEmitter);

      // System message should have cache control with TTL
      const systemMsg = capturedMessages.messages[0] as {
        role: string;
        providerOptions?: { anthropic?: { cacheControl?: { type: string; ttl?: string } } }
      };
      expect(systemMsg.role).toBe('system');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.ttl).toBe('1h');

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });

    test('cacheBreakpoint with true: adds cache control without TTL', async () => {
      const capturedMessages = { messages: [] as unknown[] };
      const aiModule = await import('ai');
      const originalStreamText = aiModule.streamText;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: createMockStreamResult(capturedMessages),
      }));

      const mockModel = createAnthropicMockModel();
      const agent = new AISDKAgent({
        model: mockModel,
        // Return true (not TTL string) - should not include ttl field
        cacheBreakpoint: (msg) => msg.role === 'system',
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        systemPrompt: 'You are a helpful assistant.',
      });

      await agent.run(input, eventEmitter);

      // System message should have cache control WITHOUT ttl field (Anthropic defaults to 5m)
      const systemMsg = capturedMessages.messages[0] as {
        role: string;
        providerOptions?: { anthropic?: { cacheControl?: { type: string; ttl?: string } } }
      };
      expect(systemMsg.role).toBe('system');
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.type).toBe('ephemeral');
      // ttl field should not be present when returning true
      expect(systemMsg.providerOptions?.anthropic?.cacheControl?.ttl).toBeUndefined();

      mock.module('ai', () => ({
        ...aiModule,
        streamText: originalStreamText,
      }));
    });
  });

  describe('Multi-step tool refresh bugs', () => {
    /**
     * Helper to extract text from AI SDK content format.
     * AI SDK transforms user message content from string to [{ type: 'text', text: '...' }].
     */
    function extractTextContent(content: unknown): string {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .filter((part: { type?: string }) => part.type === 'text')
          .map((part: { text?: string }) => part.text || '')
          .join('');
      }
      return String(content);
    }

    /**
     * Helper to wait for a pending tool call and resolve it.
     * Polls emittedEvents for TOOL_CALL_END events that have a pending resolver in session.
     */
    function waitAndResolveToolCall(
      emittedEvents: AGUIEventExtended[],
      session: { pendingToolCalls: Map<string, (content: string) => void> },
      result: string = JSON.stringify({ success: true }),
      timeout: number = 10000,
    ): Promise<void> {
      return new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          const toolCallEnds = emittedEvents.filter(e => e.type === EventType.TOOL_CALL_END);
          for (const toolCallEnd of toolCallEnds) {
            const tcId = (toolCallEnd as { toolCallId: string }).toolCallId;
            if (session.pendingToolCalls.has(tcId)) {
              clearInterval(checkInterval);
              const resolver = session.pendingToolCalls.get(tcId);
              if (resolver) {
                resolver(result);
              }
              resolve();
              return;
            }
          }
        }, 10);
        setTimeout(() => { clearInterval(checkInterval); resolve(); }, timeout);
      });
    }

    test('MCP tools should be preserved in session.tools when client sends updated tools mid-run', async () => {
      // Bug: server.handleToolResult replaces session.tools with only client tools,
      // dropping MCP tools. The agent reads session.tools at each step, so if MCP tools
      // are removed from session.tools between steps, they disappear from the model.
      //
      // This test verifies the agent sees both client and MCP tools on step(1) when
      // session.tools is correctly maintained (with the fix in server.handleToolResult).

      const capturedToolsPerStep: string[][] = [];
      const toolCallId = 'tool-call-mcp-bug';
      let callCount = 0;

      const mockModel = new MockLanguageModelV3({
        doStream: async ({ tools }) => {
          callCount++;
          if (tools) {
            capturedToolsPerStep.push(
              Object.values(tools).map((t: { name?: string }) => t.name || 'unknown')
            );
          } else {
            capturedToolsPerStep.push([]);
          }

          if (callCount === 1) {
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'tool-input-start', id: toolCallId, toolName: 'navigate' },
                  { type: 'tool-input-delta', id: toolCallId, delta: '{"page":"settings"}' },
                  { type: 'tool-input-end', id: toolCallId },
                  { type: 'tool-call', toolCallId, toolName: 'navigate', input: '{"page":"settings"}' },
                  { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
                ],
              }),
              response: {
                id: 'response-1',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [
                  { role: 'assistant', content: [{ type: 'tool-call', toolCallId, toolName: 'navigate', input: { page: 'settings' } }] },
                ],
              },
            };
          }

          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-start', id: 'text-1' },
                { type: 'text-delta', id: 'text-1', delta: 'Navigated' },
                { type: 'text-end', id: 'text-1' },
                { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              ],
            }),
            response: {
              id: 'response-2',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [{ role: 'assistant', content: 'Navigated' }],
            },
          };
        },
      });

      const agent = new AISDKAgent({ model: mockModel });
      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const mcpTool: RemoteToolDefinition = {
        name: 'mcp_search',
        description: 'MCP search tool',
        parameters: { type: 'object', properties: {}, required: [] },
        _remote: {
          provider: { executeTool: mock(() => Promise.resolve({ success: true })) } as unknown as RemoteToolDefinition['_remote']['provider'],
          originalName: 'search',
        },
      };

      const clientTool: ToolDefinition = {
        name: 'navigate',
        description: 'Navigate to a page',
        parameters: { type: 'object', properties: { page: { type: 'string' } }, required: ['page'] },
      };

      const input = createTestInput({
        tools: [clientTool, mcpTool],
      });
      input.session.tools = [clientTool, mcpTool] as ToolDefinition[];

      const runPromise = agent.run(input, eventEmitter);

      await waitAndResolveToolCall(emittedEvents, input.session);

      await runPromise;

      expect(capturedToolsPerStep.length).toBe(2);

      // Step 0: both client and MCP tools should be present
      expect(capturedToolsPerStep[0].sort()).toEqual(['mcp_search', 'navigate']);

      // Step 1: MCP tools should still be present (session.tools was not modified)
      expect(capturedToolsPerStep[1].sort()).toEqual(['mcp_search', 'navigate']);
    });

    test('emits TOOL_CALL_RESULT event with actual output for MCP tool execution', async () => {
      // When an MCP tool executes server-side, the agent should emit a TOOL_CALL_RESULT
      // event so the client can store the actual result in conversation history.
      // Without this, the client would use a placeholder, causing hallucinations.

      const toolCallId = 'tool-call-mcp-result';
      const mcpResult = { weather: 'sunny', temp: 72 };
      let callCount = 0;

      const mockModel = new MockLanguageModelV3({
        doStream: async () => {
          callCount++;

          if (callCount === 1) {
            // First step: model calls MCP tool
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'tool-input-start', id: toolCallId, toolName: 'mcp_get_weather' },
                  { type: 'tool-input-delta', id: toolCallId, delta: '{"location":"Tokyo"}' },
                  { type: 'tool-input-end', id: toolCallId },
                  { type: 'tool-call', toolCallId, toolName: 'mcp_get_weather', input: '{"location":"Tokyo"}' },
                  { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
                ],
              }),
              response: {
                id: 'response-1',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [
                  { role: 'assistant', content: [{ type: 'tool-call', toolCallId, toolName: 'mcp_get_weather', input: { location: 'Tokyo' } }] },
                ],
              },
            };
          }

          // Second step: model returns text after receiving tool result
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-start', id: 'text-1' },
                { type: 'text-delta', id: 'text-1', delta: 'It is sunny and 72°F.' },
                { type: 'text-end', id: 'text-1' },
                { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              ],
            }),
            response: {
              id: 'response-2',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [{ role: 'assistant', content: 'It is sunny and 72°F.' }],
            },
          };
        },
      });

      const agent = new AISDKAgent({ model: mockModel });
      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const mcpTool: RemoteToolDefinition = {
        name: 'mcp_get_weather',
        description: 'Get weather for a location',
        parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
        _remote: {
          provider: {
            executeTool: mock(() => Promise.resolve(mcpResult)),
          } as unknown as RemoteToolDefinition['_remote']['provider'],
          originalName: 'get_weather',
        },
      };

      const input = createTestInput({ tools: [mcpTool] });
      input.session.tools = [mcpTool] as ToolDefinition[];

      await agent.run(input, eventEmitter);

      // Verify TOOL_CALL_RESULT was emitted with actual MCP result
      const toolCallResultEvent = emittedEvents.find(e => e.type === EventType.TOOL_CALL_RESULT);
      expect(toolCallResultEvent).toBeDefined();
      expect((toolCallResultEvent as { toolCallId: string }).toolCallId).toBe(toolCallId);

      const content = (toolCallResultEvent as { content: string }).content;
      expect(content).toContain('sunny');
      expect(content).toContain('72');
      expect(content).not.toContain('serverSideTool');
    });

    test('initial user message should be preserved in step(1) after tool execution', async () => {
      // Bug: After step(0) tool execution, currentMessages is replaced with only
      // response.messages (generated messages), losing the initial user message.
      // Step(1) then sends messages to the model WITHOUT the original user request.
      //
      // Reproduces: step(1) does not contain initial user message.

      const capturedMessagesPerStep: Array<Array<{ role: string; content: unknown }>> = [];
      const toolCallId = 'tool-call-msg-bug';
      let callCount = 0;

      const mockModel = new MockLanguageModelV3({
        doStream: async ({ prompt }) => {
          callCount++;
          // Capture non-system messages for this step
          const nonSystemMessages = prompt
            .filter((msg: { role: string }) => msg.role !== 'system')
            .map((msg: { role: string; content: unknown }) => ({ role: msg.role, content: msg.content }));
          capturedMessagesPerStep.push(nonSystemMessages);

          if (callCount === 1) {
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'tool-input-start', id: toolCallId, toolName: 'add_todo' },
                  { type: 'tool-input-delta', id: toolCallId, delta: '{"text":"Buy milk"}' },
                  { type: 'tool-input-end', id: toolCallId },
                  { type: 'tool-call', toolCallId, toolName: 'add_todo', input: '{"text":"Buy milk"}' },
                  { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
                ],
              }),
              response: {
                id: 'response-1',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [
                  { role: 'assistant', content: [{ type: 'tool-call', toolCallId, toolName: 'add_todo', input: { text: 'Buy milk' } }] },
                ],
              },
            };
          }

          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-start', id: 'text-1' },
                { type: 'text-delta', id: 'text-1', delta: 'Added todo: Buy milk' },
                { type: 'text-end', id: 'text-1' },
                { type: 'finish', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              ],
            }),
            response: {
              id: 'response-2',
              timestamp: new Date(),
              modelId: 'mock-model',
              headers: {},
              messages: [{ role: 'assistant', content: 'Added todo: Buy milk' }],
            },
          };
        },
      });

      const agent = new AISDKAgent({ model: mockModel });
      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      const input = createTestInput({
        tools: [{
          name: 'add_todo',
          description: 'Add a todo',
          parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        }],
        messages: [{ role: 'user' as const, content: 'Add a todo to buy milk' }],
      });

      const runPromise = agent.run(input, eventEmitter);

      await waitAndResolveToolCall(emittedEvents, input.session);

      await runPromise;

      expect(capturedMessagesPerStep.length).toBe(2);

      // Step 0: should have the user message
      const step0UserMessages = capturedMessagesPerStep[0].filter(m => m.role === 'user');
      expect(step0UserMessages.length).toBe(1);
      expect(extractTextContent(step0UserMessages[0].content)).toBe('Add a todo to buy milk');

      // Step 1: should STILL have the user message (but bug causes it to be missing)
      const step1UserMessages = capturedMessagesPerStep[1].filter(m => m.role === 'user');
      expect(step1UserMessages.length).toBe(1);
      expect(extractTextContent(step1UserMessages[0].content)).toBe('Add a todo to buy milk');
    });
  });

  describe('Trace ID cleanup on error', () => {
    test('popTraceIdForRun is called on error to prevent memory leak', async () => {
      const mockModel = new MockLanguageModelV3({
        doStream: async () => {
          throw new Error('API Error');
        },
      });

      const agent = new AISDKAgent({ model: mockModel });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const input = createTestInput();

      // Pre-populate a trace ID for this run (simulating what the span processor would do)
      pushTraceIdForRun(input.runId, 'trace-123');

      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(false);

      // Verify the trace ID was cleaned up by the catch block
      // (popTraceIdForRun returns undefined when already removed)
      expect(popTraceIdForRun(input.runId)).toBeUndefined();
    });
  });

  describe('Pre-streamText error recording', () => {
    test('records pre-streamText errors via span.recordError', async () => {
      // To trigger a pre-streamText error, we use a cacheBreakpoint function that throws.
      // applyCacheBreakpoints runs before streamTextStarted = true, so this error
      // hits the `if (!streamTextStarted)` path in the catch block.
      const mockModel = new MockLanguageModelV3({
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022',
        doStream: async () => {
          throw new Error('Should not reach streamText');
        },
      });

      // Mock the telemetry module to spy on span.recordError
      const telemetryModule = await import('../telemetry');

      const recordedCalls: Array<{ runId: string; errorCategory: string; errorMessage: string }> = [];
      mock.module('../telemetry', () => ({
        ...telemetryModule,
        startRunSpan: () => ({
          active: false,
          wrap: <T>(fn: () => T): T => fn(),
          setInput: () => {},
          setOutput: () => {},
          end: () => {},
          endWithError: () => {},
          popTraceId: () => undefined,
          recordError: (params: { runId: string; errorCategory: string; errorMessage: string }) => {
            recordedCalls.push(params);
          },
        }),
      }));

      // Re-import to pick up the mock (dynamic import after mock.module)
      const { AISDKAgent: MockedAISDKAgent } = await import('./AISDKAgent');

      const agent = new MockedAISDKAgent({
        model: mockModel,
        // cacheBreakpoint throws before streamText is called
        cacheBreakpoint: () => { throw new Error('Cache breakpoint error'); },
      });

      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = {
        emit: (event) => emittedEvents.push(event),
      };

      const input = createTestInput();
      const result = await agent.run(input, eventEmitter);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cache breakpoint error');

      // Verify span.recordError was called with pre_stream_error category
      expect(recordedCalls.length).toBeGreaterThanOrEqual(1);
      const preStreamCall = recordedCalls.find(c => c.errorCategory === 'pre_stream_error');
      expect(preStreamCall).toBeDefined();
      expect(preStreamCall!.runId).toBe(input.runId);
      expect(preStreamCall!.errorMessage).toBe('Cache breakpoint error');

      // Verify RUN_ERROR was emitted
      const runErrorEvent = emittedEvents.find(e => e.type === EventType.RUN_ERROR);
      expect(runErrorEvent).toBeDefined();

      // Restore original
      mock.module('../telemetry', () => telemetryModule);
    });
  });
});
