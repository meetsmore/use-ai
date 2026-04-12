import { describe, expect, test } from 'bun:test';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput, EventEmitter, AGUIEventExtended } from './types';
import { EventType } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

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

describe('AISDKAgent reasoning events', () => {
  test('emits REASONING_* events in correct order before text events', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'reasoning-start', id: 'r1' },
            { type: 'reasoning-delta', id: 'r1', delta: 'Let me think...' },
            { type: 'reasoning-delta', id: 'r1', delta: ' about this.' },
            { type: 'reasoning-end', id: 'r1' },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'The answer is 42.' },
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
          messages: [{ role: 'assistant', content: 'The answer is 42.' }],
        },
      }),
    });

    const agent = new AISDKAgent({
      model: mockModel,
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } } },
    });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const input = createTestInput();
    const result = await agent.run(input, eventEmitter);
    expect(result.success).toBe(true);

    // Verify reasoning events were emitted
    const reasoningStart = emittedEvents.filter(e => e.type === EventType.REASONING_START);
    const reasoningMsgStart = emittedEvents.filter(e => e.type === EventType.REASONING_MESSAGE_START);
    const reasoningContent = emittedEvents.filter(e => e.type === EventType.REASONING_MESSAGE_CONTENT);
    const reasoningMsgEnd = emittedEvents.filter(e => e.type === EventType.REASONING_MESSAGE_END);
    const reasoningEnd = emittedEvents.filter(e => e.type === EventType.REASONING_END);

    expect(reasoningStart).toHaveLength(1);
    expect(reasoningMsgStart).toHaveLength(1);
    expect(reasoningContent).toHaveLength(2);
    expect((reasoningContent[0] as { delta: string }).delta).toBe('Let me think...');
    expect((reasoningContent[1] as { delta: string }).delta).toBe(' about this.');
    expect(reasoningMsgEnd).toHaveLength(1);
    expect(reasoningEnd).toHaveLength(1);

    // Verify reasoning events precede text events
    const relevantTypes = [
      EventType.REASONING_START, EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_CONTENT, EventType.REASONING_MESSAGE_END,
      EventType.REASONING_END,
      EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END,
    ] as string[];
    const ordered = emittedEvents
      .filter(e => relevantTypes.includes(e.type as string))
      .map(e => e.type);

    expect(ordered).toEqual([
      EventType.REASONING_START,
      EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_END,
      EventType.REASONING_END,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
    ]);
  });

  test('captures signature via REASONING_ENCRYPTED_VALUE event', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'reasoning-start', id: 'r1' },
            { type: 'reasoning-delta', id: 'r1', delta: 'thinking' },
            {
              type: 'reasoning-end',
              id: 'r1',
              providerMetadata: { anthropic: { signature: 'test-signature-123' } },
            },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Answer.' },
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
          messages: [{ role: 'assistant', content: 'Answer.' }],
        },
      }),
    });

    const agent = new AISDKAgent({
      model: mockModel,
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } } },
    });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    await agent.run(createTestInput(), eventEmitter);

    const encryptedValueEvent = emittedEvents.find(e => e.type === EventType.REASONING_ENCRYPTED_VALUE);
    expect(encryptedValueEvent).toBeDefined();
    expect((encryptedValueEvent as { subtype: string }).subtype).toBe('message');
    expect((encryptedValueEvent as { encryptedValue: string }).encryptedValue)
      .toBe(JSON.stringify({ anthropic: { signature: 'test-signature-123' } }));
  });

  test('REASONING_START and REASONING_END share the same messageId, distinct from REASONING_MESSAGE_* messageId', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'reasoning-start', id: 'r1' },
            { type: 'reasoning-delta', id: 'r1', delta: 'thinking...' },
            { type: 'reasoning-end', id: 'r1' },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Done.' },
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
          messages: [{ role: 'assistant', content: 'Done.' }],
        },
      }),
    });

    const agent = new AISDKAgent({
      model: mockModel,
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } } },
    });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    await agent.run(createTestInput(), eventEmitter);

    const rStart = emittedEvents.find(e => e.type === EventType.REASONING_START) as { messageId: string };
    const rEnd = emittedEvents.find(e => e.type === EventType.REASONING_END) as { messageId: string };
    const rmStart = emittedEvents.find(e => e.type === EventType.REASONING_MESSAGE_START) as { messageId: string };
    const rmEnd = emittedEvents.find(e => e.type === EventType.REASONING_MESSAGE_END) as { messageId: string };

    // REASONING_START and REASONING_END must share the same lifecycle messageId
    expect(rStart.messageId).toBe(rEnd.messageId);

    // REASONING_MESSAGE_START and REASONING_MESSAGE_END must share the same message-level messageId
    expect(rmStart.messageId).toBe(rmEnd.messageId);

    // Lifecycle ID and message-level ID must be distinct
    expect(rStart.messageId).not.toBe(rmStart.messageId);
  });

  test('does not emit reasoning events when no reasoning chunks are present', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Hello' },
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
          messages: [{ role: 'assistant', content: 'Hello' }],
        },
      }),
    });

    const agent = new AISDKAgent({ model: mockModel });
    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    await agent.run(createTestInput(), eventEmitter);

    const reasoningEvents = emittedEvents.filter(e =>
      [
        EventType.REASONING_START, EventType.REASONING_MESSAGE_START,
        EventType.REASONING_MESSAGE_CONTENT, EventType.REASONING_MESSAGE_END,
        EventType.REASONING_END, EventType.REASONING_ENCRYPTED_VALUE,
      ].includes(e.type as EventType)
    );
    expect(reasoningEvents).toHaveLength(0);
  });
});
