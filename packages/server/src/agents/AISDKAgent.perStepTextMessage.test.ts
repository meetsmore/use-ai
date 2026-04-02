import { describe, expect, test, mock } from 'bun:test';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput, EventEmitter, AGUIEventExtended } from './types';
import { EventType } from '../types';
import type { ToolDefinition } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

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

    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, timeout);
  });
}

/**
 * Per-step TEXT_MESSAGE_END emission tests.
 *
 * Bug: TEXT_MESSAGE_START/END is emitted once per run (not per step), causing
 * all text from all steps to be concatenated into a single message. When the
 * client saves this to localStorage and reconstructs it, tool call context is
 * lost — tool calls from different steps get merged and their associated text
 * is separated.
 *
 * Expected behavior: TEXT_MESSAGE_END should be emitted per step, so that
 * each step's text and tool calls stay properly associated.
 */
describe('Per-step TEXT_MESSAGE_END emission', () => {
  describe('single-step run (no tool calls)', () => {
    test('emits exactly one TEXT_MESSAGE_START and one TEXT_MESSAGE_END', async () => {
      const mockModel = new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Hello world' },
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
            messages: [{ role: 'assistant', content: 'Hello world' }],
          },
        }),
      });

      const agent = new AISDKAgent({ model: mockModel });
      const emittedEvents: AGUIEventExtended[] = [];
      const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

      await agent.run(createTestInput(), eventEmitter);

      const textStarts = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_START);
      const textEnds = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_END);

      expect(textStarts.length).toBe(1);
      expect(textEnds.length).toBe(1);
    });
  });

  describe('multi-step run with text + tool calls', () => {
    /**
     * Creates a mock model that simulates a multi-step run:
     * Step 0: text("Planning...") + tool_call(search_users)
     * Step 1: text("Done!") (final response)
     */
    function createTwoStepMockWithTextAndToolCall() {
      const aiModule = require('ai');
      const originalStreamText = aiModule.streamText;
      let callCount = 0;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: (options: unknown) => {
          callCount++;

          if (callCount === 1) {
            // Step 0: text + tool call
            return {
              fullStream: (async function* () {
                yield { type: 'start-step', stepType: 'initial' };
                yield { type: 'text-start', id: 'text-step0' };
                yield { type: 'text-delta', id: 'text-step0', text: 'Planning the task.' };
                yield { type: 'text-end', id: 'text-step0' };
                yield { type: 'tool-input-start', id: 'call-1', toolName: 'search_users' };
                yield { type: 'tool-input-delta', id: 'call-1', delta: '{"query":"yamamoto"}' };
                yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'search_users', input: { query: 'yamamoto' } };
                yield { type: 'tool-result', toolCallId: 'call-1', toolName: 'search_users', output: { users: [] } };
                yield { type: 'finish-step', finishReason: 'tool-calls', usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 }, isContinued: true };
                yield {
                  type: 'finish',
                  finishReason: 'tool-calls',
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
                      { type: 'text', text: 'Planning the task.' },
                      { type: 'tool-call', toolCallId: 'call-1', toolName: 'search_users', input: { query: 'yamamoto' } },
                    ],
                  },
                  {
                    role: 'tool',
                    content: [
                      { type: 'tool-result', toolCallId: 'call-1', toolName: 'search_users', output: { users: [] } },
                    ],
                  },
                ],
              }),
            };
          } else {
            // Step 1: text only (final response)
            return {
              fullStream: (async function* () {
                yield { type: 'start-step', stepType: 'continue' };
                yield { type: 'text-start', id: 'text-step1' };
                yield { type: 'text-delta', id: 'text-step1', text: 'No users found.' };
                yield { type: 'text-end', id: 'text-step1' };
                yield { type: 'finish-step', finishReason: 'stop', usage: { inputTokens: 80, outputTokens: 15, totalTokens: 95 }, isContinued: false };
                yield {
                  type: 'finish',
                  finishReason: 'stop',
                  usage: { inputTokens: 80, outputTokens: 15, totalTokens: 95 },
                };
              })(),
              response: Promise.resolve({
                id: 'response-step-1',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [
                  { role: 'assistant', content: 'No users found.' },
                ],
              }),
            };
          }
        },
      }));

      return {
        getCallCount: () => callCount,
        restore: () => {
          mock.module('ai', () => ({
            ...aiModule,
            streamText: originalStreamText,
          }));
        },
      };
    }

    test('emits TEXT_MESSAGE_END for each step that produces text', async () => {
      const { restore } = createTwoStepMockWithTextAndToolCall();

      try {
        const mockModel = new MockLanguageModelV3({ doStream: async () => { throw new Error('unused'); } });
        const agent = new AISDKAgent({ model: mockModel });

        const testTool: ToolDefinition = {
          name: 'search_users',
          description: 'Search for users',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        };

        const session = {
          socket: {} as never,
          clientId: 'client-1',
          threadId: 'thread-1',
          tools: [testTool] as never[],
          state: null,
          pendingToolCalls: new Map<string, (content: string) => void>(),
          pendingToolApprovals: new Map(),
          ipAddress: '127.0.0.1',
        };

        const emittedEvents: AGUIEventExtended[] = [];
        const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

        const input = createTestInput({ session: session as never, tools: [testTool] as never[] });
        await agent.run(input, eventEmitter);

        // Should have 2 TEXT_MESSAGE_START events (one per step)
        const textStarts = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_START);
        expect(textStarts.length).toBe(2);

        // Should have 2 TEXT_MESSAGE_END events (one per step)
        const textEnds = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_END);
        expect(textEnds.length).toBe(2);

        // Each TEXT_MESSAGE_END should have a different messageId matching its TEXT_MESSAGE_START
        const startIds = textStarts.map(e => (e as { messageId: string }).messageId);
        const endIds = textEnds.map(e => (e as { messageId: string }).messageId);
        expect(startIds[0]).toBe(endIds[0]);
        expect(startIds[1]).toBe(endIds[1]);
        expect(startIds[0]).not.toBe(startIds[1]);
      } finally {
        restore();
      }
    });

    test('TEXT_MESSAGE_END for step with tool calls comes before STEP_FINISHED', async () => {
      const { restore } = createTwoStepMockWithTextAndToolCall();

      try {
        const mockModel = new MockLanguageModelV3({ doStream: async () => { throw new Error('unused'); } });
        const agent = new AISDKAgent({ model: mockModel });

        const testTool: ToolDefinition = {
          name: 'search_users',
          description: 'Search for users',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        };

        const session = {
          socket: {} as never,
          clientId: 'client-1',
          threadId: 'thread-1',
          tools: [testTool] as never[],
          state: null,
          pendingToolCalls: new Map<string, (content: string) => void>(),
          pendingToolApprovals: new Map(),
          ipAddress: '127.0.0.1',
        };

        const emittedEvents: AGUIEventExtended[] = [];
        const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

        const input = createTestInput({ session: session as never, tools: [testTool] as never[] });
        await agent.run(input, eventEmitter);

        // Find the first TEXT_MESSAGE_END and first STEP_FINISHED
        const firstTextEnd = emittedEvents.findIndex(e => e.type === EventType.TEXT_MESSAGE_END);
        const firstStepFinished = emittedEvents.findIndex(e => e.type === EventType.STEP_FINISHED);

        expect(firstTextEnd).toBeGreaterThan(-1);
        expect(firstStepFinished).toBeGreaterThan(-1);
        // TEXT_MESSAGE_END should come before or at STEP_FINISHED
        expect(firstTextEnd).toBeLessThanOrEqual(firstStepFinished);
      } finally {
        restore();
      }
    });

    test('event order: TEXT_START → TEXT_CONTENT → TEXT_END → TOOL_CALL → STEP_FINISHED per step', async () => {
      const { restore } = createTwoStepMockWithTextAndToolCall();

      try {
        const mockModel = new MockLanguageModelV3({ doStream: async () => { throw new Error('unused'); } });
        const agent = new AISDKAgent({ model: mockModel });

        const testTool: ToolDefinition = {
          name: 'search_users',
          description: 'Search for users',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        };

        const session = {
          socket: {} as never,
          clientId: 'client-1',
          threadId: 'thread-1',
          tools: [testTool] as never[],
          state: null,
          pendingToolCalls: new Map<string, (content: string) => void>(),
          pendingToolApprovals: new Map(),
          ipAddress: '127.0.0.1',
        };

        const emittedEvents: AGUIEventExtended[] = [];
        const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

        const input = createTestInput({ session: session as never, tools: [testTool] as never[] });
        await agent.run(input, eventEmitter);

        // Extract event types in order (skip RUN_STARTED, MESSAGES_SNAPSHOT, STATE_SNAPSHOT)
        const streamEvents = emittedEvents.filter(e =>
          ![EventType.RUN_STARTED, EventType.MESSAGES_SNAPSHOT, EventType.STATE_SNAPSHOT, EventType.RUN_FINISHED].includes(e.type as EventType)
        ).map(e => e.type);

        // Step 0 should have: STEP_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT → TEXT_MESSAGE_END → TOOL_CALL_START → ... → STEP_FINISHED
        const step0Start = streamEvents.indexOf(EventType.STEP_STARTED);
        const step0TextStart = streamEvents.indexOf(EventType.TEXT_MESSAGE_START);
        const step0TextEnd = streamEvents.indexOf(EventType.TEXT_MESSAGE_END);
        const step0ToolStart = streamEvents.indexOf(EventType.TOOL_CALL_START);
        const step0Finished = streamEvents.indexOf(EventType.STEP_FINISHED);

        expect(step0Start).toBeLessThan(step0TextStart);
        expect(step0TextStart).toBeLessThan(step0TextEnd);
        expect(step0TextEnd).toBeLessThan(step0ToolStart);
        expect(step0ToolStart).toBeLessThan(step0Finished);
      } finally {
        restore();
      }
    });
  });

  describe('three-step run (text+tool → text+tool → text)', () => {
    /**
     * Simulates the exact scenario from the bug report:
     * Step 0: text("Planning...") + tool_call(search_users, "山本")
     * Step 1: text("Not found, retrying...") + tool_call(search_users, "Yamamoto")
     * Step 2: text("User not found.") (final)
     */
    function createThreeStepMock() {
      const aiModule = require('ai');
      const originalStreamText = aiModule.streamText;
      let callCount = 0;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: (options: unknown) => {
          callCount++;

          if (callCount === 1) {
            return {
              fullStream: (async function* () {
                yield { type: 'start-step', stepType: 'initial' };
                yield { type: 'text-start', id: 'text-s0' };
                yield { type: 'text-delta', id: 'text-s0', text: 'Step 0 text.' };
                yield { type: 'text-end', id: 'text-s0' };
                yield { type: 'tool-input-start', id: 'call-1', toolName: 'search_users' };
                yield { type: 'tool-input-delta', id: 'call-1', delta: '{"query":"yamamoto"}' };
                yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'search_users', input: { query: 'yamamoto' } };
                yield { type: 'tool-result', toolCallId: 'call-1', toolName: 'search_users', output: { users: [] } };
                yield { type: 'finish-step', finishReason: 'tool-calls', usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 }, isContinued: true };
                yield { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 } };
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
                      { type: 'text', text: 'Step 0 text.' },
                      { type: 'tool-call', toolCallId: 'call-1', toolName: 'search_users', input: { query: 'yamamoto' } },
                    ],
                  },
                  {
                    role: 'tool',
                    content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'search_users', output: { users: [] } }],
                  },
                ],
              }),
            };
          } else if (callCount === 2) {
            return {
              fullStream: (async function* () {
                yield { type: 'start-step', stepType: 'continue' };
                yield { type: 'text-start', id: 'text-s1' };
                yield { type: 'text-delta', id: 'text-s1', text: 'Step 1 text.' };
                yield { type: 'text-end', id: 'text-s1' };
                yield { type: 'tool-input-start', id: 'call-2', toolName: 'search_users' };
                yield { type: 'tool-input-delta', id: 'call-2', delta: '{"query":"Yamamoto"}' };
                yield { type: 'tool-call', toolCallId: 'call-2', toolName: 'search_users', input: { query: 'Yamamoto' } };
                yield { type: 'tool-result', toolCallId: 'call-2', toolName: 'search_users', output: { users: [] } };
                yield { type: 'finish-step', finishReason: 'tool-calls', usage: { inputTokens: 80, outputTokens: 15, totalTokens: 95 }, isContinued: true };
                yield { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 80, outputTokens: 15, totalTokens: 95 } };
              })(),
              response: Promise.resolve({
                id: 'response-step-1',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [
                  {
                    role: 'assistant',
                    content: [
                      { type: 'text', text: 'Step 1 text.' },
                      { type: 'tool-call', toolCallId: 'call-2', toolName: 'search_users', input: { query: 'Yamamoto' } },
                    ],
                  },
                  {
                    role: 'tool',
                    content: [{ type: 'tool-result', toolCallId: 'call-2', toolName: 'search_users', output: { users: [] } }],
                  },
                ],
              }),
            };
          } else {
            return {
              fullStream: (async function* () {
                yield { type: 'start-step', stepType: 'continue' };
                yield { type: 'text-start', id: 'text-s2' };
                yield { type: 'text-delta', id: 'text-s2', text: 'Step 2 final text.' };
                yield { type: 'text-end', id: 'text-s2' };
                yield { type: 'finish-step', finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 }, isContinued: false };
                yield { type: 'finish', finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } };
              })(),
              response: Promise.resolve({
                id: 'response-step-2',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [
                  { role: 'assistant', content: 'Step 2 final text.' },
                ],
              }),
            };
          }
        },
      }));

      return {
        getCallCount: () => callCount,
        restore: () => {
          mock.module('ai', () => ({
            ...aiModule,
            streamText: originalStreamText,
          }));
        },
      };
    }

    test('emits 3 TEXT_MESSAGE_START/END pairs for 3-step run', async () => {
      const { restore } = createThreeStepMock();

      try {
        const mockModel = new MockLanguageModelV3({ doStream: async () => { throw new Error('unused'); } });
        const agent = new AISDKAgent({ model: mockModel });

        const testTool: ToolDefinition = {
          name: 'search_users',
          description: 'Search for users',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        };

        const session = {
          socket: {} as never,
          clientId: 'client-1',
          threadId: 'thread-1',
          tools: [testTool] as never[],
          state: null,
          pendingToolCalls: new Map<string, (content: string) => void>(),
          pendingToolApprovals: new Map(),
          ipAddress: '127.0.0.1',
        };

        const emittedEvents: AGUIEventExtended[] = [];
        const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

        const input = createTestInput({ session: session as never, tools: [testTool] as never[] });
        await agent.run(input, eventEmitter);

        const textStarts = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_START);
        const textEnds = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_END);

        expect(textStarts.length).toBe(3);
        expect(textEnds.length).toBe(3);

        // Each pair should have matching messageIds
        for (let i = 0; i < 3; i++) {
          const startId = (textStarts[i] as { messageId: string }).messageId;
          const endId = (textEnds[i] as { messageId: string }).messageId;
          expect(startId).toBe(endId);
        }

        // All messageIds should be different
        const allIds = textStarts.map(e => (e as { messageId: string }).messageId);
        expect(new Set(allIds).size).toBe(3);
      } finally {
        restore();
      }
    });

    test('conversationHistory preserves per-step text+tool association', async () => {
      const { restore } = createThreeStepMock();

      try {
        const mockModel = new MockLanguageModelV3({ doStream: async () => { throw new Error('unused'); } });
        const agent = new AISDKAgent({ model: mockModel });

        const testTool: ToolDefinition = {
          name: 'search_users',
          description: 'Search for users',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        };

        const session = {
          socket: {} as never,
          clientId: 'client-1',
          threadId: 'thread-1',
          tools: [testTool] as never[],
          state: null,
          pendingToolCalls: new Map<string, (content: string) => void>(),
          pendingToolApprovals: new Map(),
          ipAddress: '127.0.0.1',
        };

        const emittedEvents: AGUIEventExtended[] = [];
        const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

        const input = createTestInput({ session: session as never, tools: [testTool] as never[] });
        const result = await agent.run(input, eventEmitter);

        expect(result.success).toBe(true);

        // conversationHistory should have:
        // [0] user message
        // [1] assistant (text + tool-call for step 0)
        // [2] tool result for step 0
        // [3] assistant (text + tool-call for step 1)
        // [4] tool result for step 1
        // [5] assistant (text only, step 2 final)
        expect(result.conversationHistory.length).toBe(6);

        // Step 0 assistant should have BOTH text and tool-call
        const step0Assistant = result.conversationHistory[1] as { role: string; content: unknown };
        expect(step0Assistant.role).toBe('assistant');
        expect(Array.isArray(step0Assistant.content)).toBe(true);
        const step0Content = step0Assistant.content as Array<{ type: string }>;
        expect(step0Content.some(c => c.type === 'text')).toBe(true);
        expect(step0Content.some(c => c.type === 'tool-call')).toBe(true);

        // Step 1 assistant should also have BOTH text and tool-call
        const step1Assistant = result.conversationHistory[3] as { role: string; content: unknown };
        expect(step1Assistant.role).toBe('assistant');
        expect(Array.isArray(step1Assistant.content)).toBe(true);
        const step1Content = step1Assistant.content as Array<{ type: string }>;
        expect(step1Content.some(c => c.type === 'text')).toBe(true);
        expect(step1Content.some(c => c.type === 'tool-call')).toBe(true);

        // Step 2 assistant should have only text
        const step2Assistant = result.conversationHistory[5] as { role: string; content: unknown };
        expect(step2Assistant.role).toBe('assistant');
        expect(step2Assistant.content).toBe('Step 2 final text.');
      } finally {
        restore();
      }
    });
  });

  describe('step with tool calls but no text', () => {
    test('does not emit TEXT_MESSAGE_END for steps without text', async () => {
      const aiModule = require('ai');
      const originalStreamText = aiModule.streamText;
      let callCount = 0;

      mock.module('ai', () => ({
        ...aiModule,
        streamText: (options: unknown) => {
          callCount++;

          if (callCount === 1) {
            // Step 0: tool call only (no text)
            return {
              fullStream: (async function* () {
                yield { type: 'start-step', stepType: 'initial' };
                yield { type: 'tool-input-start', id: 'call-1', toolName: 'test_tool' };
                yield { type: 'tool-input-delta', id: 'call-1', delta: '{}' };
                yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'test_tool', input: {} };
                yield { type: 'tool-result', toolCallId: 'call-1', toolName: 'test_tool', output: { ok: true } };
                yield { type: 'finish-step', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, isContinued: true };
                yield { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
              })(),
              response: Promise.resolve({
                id: 'resp-0',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [
                  {
                    role: 'assistant',
                    content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'test_tool', input: {} }],
                  },
                  {
                    role: 'tool',
                    content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'test_tool', output: { ok: true } }],
                  },
                ],
              }),
            };
          } else {
            // Step 1: text only (final)
            return {
              fullStream: (async function* () {
                yield { type: 'start-step', stepType: 'continue' };
                yield { type: 'text-start', id: 'text-1' };
                yield { type: 'text-delta', id: 'text-1', text: 'Done.' };
                yield { type: 'text-end', id: 'text-1' };
                yield { type: 'finish-step', finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 }, isContinued: false };
                yield { type: 'finish', finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 } };
              })(),
              response: Promise.resolve({
                id: 'resp-1',
                timestamp: new Date(),
                modelId: 'mock-model',
                headers: {},
                messages: [{ role: 'assistant', content: 'Done.' }],
              }),
            };
          }
        },
      }));

      try {
        const mockModel = new MockLanguageModelV3({ doStream: async () => { throw new Error('unused'); } });
        const agent = new AISDKAgent({ model: mockModel });

        const testTool: ToolDefinition = {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        };

        const session = {
          socket: {} as never,
          clientId: 'client-1',
          threadId: 'thread-1',
          tools: [testTool] as never[],
          state: null,
          pendingToolCalls: new Map<string, (content: string) => void>(),
          pendingToolApprovals: new Map(),
          ipAddress: '127.0.0.1',
        };

        const emittedEvents: AGUIEventExtended[] = [];
        const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };

        const input = createTestInput({ session: session as never, tools: [testTool] as never[] });
        await agent.run(input, eventEmitter);

        // Only 1 TEXT_MESSAGE_START/END (from step 1, not step 0)
        const textStarts = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_START);
        const textEnds = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_END);

        expect(textStarts.length).toBe(1);
        expect(textEnds.length).toBe(1);
      } finally {
        mock.module('ai', () => ({
          ...aiModule,
          streamText: originalStreamText,
        }));
      }
    });
  });
});
