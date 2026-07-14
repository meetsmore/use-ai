import { describe, expect, test, mock } from 'bun:test';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput, EventEmitter, AGUIEventExtended } from './types';
import { EventType } from '../types';
import type { ToolDefinition } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai';

/**
 * Server-side tests: AISDKAgent emits TEXT_MESSAGE_START/END per step.
 *
 * Bug: messageId/hasEmittedTextStart lived in RunContext (shared across steps),
 * so a multi-step run emitted only one TEXT_MESSAGE_START/END pair for the
 * entire run. Fix: moved to StepContext, so each step gets its own pair.
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
    messages: [{ role: 'user', content: 'Hello' }],
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

function createTwoStepMock() {
  const aiModule = require('ai');
  const originalStreamText = aiModule.streamText;
  let callCount = 0;

  mock.module('ai', () => ({
    ...aiModule,
    streamText: () => {
      callCount++;
      if (callCount === 1) {
        // Step 0: text + tool call
        return {
          fullStream: (async function* () {
            yield { type: 'start-step', stepType: 'initial' };
            yield { type: 'text-start', id: 'text-s0' };
            yield { type: 'text-delta', id: 'text-s0', text: 'Step 0.' };
            yield { type: 'text-end', id: 'text-s0' };
            yield { type: 'tool-input-start', id: 'call-1', toolName: 'search' };
            yield { type: 'tool-input-delta', id: 'call-1', delta: '{"q":"a"}' };
            yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: { q: 'a' } };
            yield { type: 'tool-result', toolCallId: 'call-1', toolName: 'search', output: {} };
            yield { type: 'finish-step', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, isContinued: true };
            yield { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
          })(),
          response: Promise.resolve({
            id: 'resp-0', timestamp: new Date(), modelId: 'mock', headers: {},
            messages: [
              { role: 'assistant', content: [{ type: 'text', text: 'Step 0.' }, { type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: { q: 'a' } }] },
              { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'search', output: {} }] },
            ],
          }),
        };
      } else {
        // Step 1: text only (final)
        return {
          fullStream: (async function* () {
            yield { type: 'start-step', stepType: 'continue' };
            yield { type: 'text-start', id: 'text-s1' };
            yield { type: 'text-delta', id: 'text-s1', text: 'Done.' };
            yield { type: 'text-end', id: 'text-s1' };
            yield { type: 'finish-step', finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 }, isContinued: false };
            yield { type: 'finish', finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 } };
          })(),
          response: Promise.resolve({
            id: 'resp-1', timestamp: new Date(), modelId: 'mock', headers: {},
            messages: [{ role: 'assistant', content: 'Done.' }],
          }),
        };
      }
    },
  }));

  return {
    restore: () => mock.module('ai', () => ({ ...aiModule, streamText: originalStreamText })),
  };
}

function createToolOnlyThenTextMock() {
  const aiModule = require('ai');
  const originalStreamText = aiModule.streamText;
  let callCount = 0;

  mock.module('ai', () => ({
    ...aiModule,
    streamText: () => {
      callCount++;
      if (callCount === 1) {
        // Step 0: tool only (no text)
        return {
          fullStream: (async function* () {
            yield { type: 'start-step', stepType: 'initial' };
            yield { type: 'tool-input-start', id: 'call-1', toolName: 'test_tool' };
            yield { type: 'tool-input-delta', id: 'call-1', delta: '{}' };
            yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'test_tool', input: {} };
            yield { type: 'tool-result', toolCallId: 'call-1', toolName: 'test_tool', output: {} };
            yield { type: 'finish-step', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, isContinued: true };
            yield { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
          })(),
          response: Promise.resolve({
            id: 'resp-0', timestamp: new Date(), modelId: 'mock', headers: {},
            messages: [
              { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'test_tool', input: {} }] },
              { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'test_tool', output: {} }] },
            ],
          }),
        };
      } else {
        // Step 1: text only
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
            id: 'resp-1', timestamp: new Date(), modelId: 'mock', headers: {},
            messages: [{ role: 'assistant', content: 'Done.' }],
          }),
        };
      }
    },
  }));

  return {
    restore: () => mock.module('ai', () => ({ ...aiModule, streamText: originalStreamText })),
  };
}

function createSession(tools: ToolDefinition[] = []) {
  return {
    socket: {} as never,
    clientId: 'client-1',
    threadId: 'thread-1',
    tools: tools as never[],
    state: null,
    pendingToolCalls: new Map<string, (content: string) => void>(),
    pendingToolApprovals: new Map(),
    ipAddress: '127.0.0.1',
  };
}

const searchTool: ToolDefinition = {
  name: 'search',
  description: 'Search',
  parameters: { type: 'object', properties: { q: { type: 'string' } } },
};

const testTool: ToolDefinition = {
  name: 'test_tool',
  description: 'Test',
  parameters: { type: 'object', properties: {} },
};

describe('AISDKAgent per-step TEXT_MESSAGE events', () => {
  test('2-step run emits 2 TEXT_MESSAGE_START/END pairs with distinct messageIds', async () => {
    const { restore } = createTwoStepMock();
    try {
      const agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: new MockLanguageModelV3({ doStream: async () => { throw new Error('unused'); } }) }) } });
      const events: AGUIEventExtended[] = [];
      const emitter: EventEmitter = { emit: (e) => events.push(e) };

      await agent.run(createTestInput({ session: createSession([searchTool]) as never, tools: [searchTool] as never[] }), emitter);

      const starts = events.filter(e => e.type === EventType.TEXT_MESSAGE_START);
      const ends = events.filter(e => e.type === EventType.TEXT_MESSAGE_END);

      expect(starts).toHaveLength(2);
      expect(ends).toHaveLength(2);

      const startIds = starts.map(e => (e as { messageId: string }).messageId);
      const endIds = ends.map(e => (e as { messageId: string }).messageId);
      expect(startIds[0]).toBe(endIds[0]);
      expect(startIds[1]).toBe(endIds[1]);
      expect(startIds[0]).not.toBe(startIds[1]);
    } finally {
      restore();
    }
  });

  test('tool-only step emits no TEXT_MESSAGE events', async () => {
    const { restore } = createToolOnlyThenTextMock();
    try {
      const agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: new MockLanguageModelV3({ doStream: async () => { throw new Error('unused'); } }) }) } });
      const events: AGUIEventExtended[] = [];
      const emitter: EventEmitter = { emit: (e) => events.push(e) };

      await agent.run(createTestInput({ session: createSession([testTool]) as never, tools: [testTool] as never[] }), emitter);

      const starts = events.filter(e => e.type === EventType.TEXT_MESSAGE_START);
      const ends = events.filter(e => e.type === EventType.TEXT_MESSAGE_END);

      // Only step 1 has text, step 0 is tool-only
      expect(starts).toHaveLength(1);
      expect(ends).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test('TEXT_MESSAGE_END comes before TOOL_CALL_START in same step', async () => {
    const { restore } = createTwoStepMock();
    try {
      const agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: new MockLanguageModelV3({ doStream: async () => { throw new Error('unused'); } }) }) } });
      const events: AGUIEventExtended[] = [];
      const emitter: EventEmitter = { emit: (e) => events.push(e) };

      await agent.run(createTestInput({ session: createSession([searchTool]) as never, tools: [searchTool] as never[] }), emitter);

      const types = events.map(e => e.type);
      const firstTextEnd = types.indexOf(EventType.TEXT_MESSAGE_END);
      const firstToolStart = types.indexOf(EventType.TOOL_CALL_START);

      expect(firstTextEnd).toBeGreaterThan(-1);
      expect(firstToolStart).toBeGreaterThan(-1);
      expect(firstTextEnd).toBeLessThan(firstToolStart);
    } finally {
      restore();
    }
  });
});
