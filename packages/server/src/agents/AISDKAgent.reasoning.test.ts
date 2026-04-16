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

describe('AISDKAgent reasoning events (Anthropic)', () => {
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

describe('AISDKAgent reasoning events (OpenAI)', () => {
  test('emits REASONING_* events in correct order for OpenAI reasoning model', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'reasoning-start',
              id: 'rs_abc123:0',
              providerMetadata: {
                openai: {
                  itemId: 'rs_abc123',
                  reasoningEncryptedContent: 'gAAAAA_initial_encrypted',
                },
              },
            },
            {
              type: 'reasoning-delta',
              id: 'rs_abc123:0',
              delta: 'Let me think about this',
              providerMetadata: { openai: { itemId: 'rs_abc123' } },
            },
            {
              type: 'reasoning-delta',
              id: 'rs_abc123:0',
              delta: ' step by step.',
              providerMetadata: { openai: { itemId: 'rs_abc123' } },
            },
            {
              type: 'reasoning-end',
              id: 'rs_abc123:0',
              providerMetadata: {
                openai: {
                  itemId: 'rs_abc123',
                  reasoningEncryptedContent: 'gAAAAA_final_encrypted',
                },
              },
            },
            {
              type: 'text-start',
              id: 'msg_xyz789',
              providerMetadata: { openai: { itemId: 'msg_xyz789', phase: 'final_answer' } },
            },
            { type: 'text-delta', id: 'msg_xyz789', delta: '2 + 2 = 4.' },
            {
              type: 'text-end',
              id: 'msg_xyz789',
              providerMetadata: { openai: { itemId: 'msg_xyz789', phase: 'final_answer' } },
            },
            {
              type: 'finish',
              finishReason: 'stop' as const,
              usage: { inputTokens: 18, outputTokens: 59, totalTokens: 77 },
            },
          ],
        }),
        response: {
          id: 'response-1',
          timestamp: new Date(),
          modelId: 'gpt-5.4-mini',
          headers: {},
          messages: [{ role: 'assistant', content: '2 + 2 = 4.' }],
        },
      }),
    });

    const agent = new AISDKAgent({
      model: mockModel,
      providerOptions: { openai: { reasoningSummary: 'detailed', reasoningEffort: 'low' } },
    });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    const result = await agent.run(createTestInput(), eventEmitter);
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
    expect((reasoningContent[0] as { delta: string }).delta).toBe('Let me think about this');
    expect((reasoningContent[1] as { delta: string }).delta).toBe(' step by step.');
    expect(reasoningMsgEnd).toHaveLength(1);
    expect(reasoningEnd).toHaveLength(1);

    // Verify event ordering: reasoning before text
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

  test('captures OpenAI reasoningEncryptedContent via REASONING_ENCRYPTED_VALUE event', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'reasoning-start',
              id: 'rs_abc123:0',
              providerMetadata: {
                openai: {
                  itemId: 'rs_abc123',
                  reasoningEncryptedContent: 'gAAAAA_initial_encrypted',
                },
              },
            },
            {
              type: 'reasoning-delta',
              id: 'rs_abc123:0',
              delta: 'thinking',
              providerMetadata: { openai: { itemId: 'rs_abc123' } },
            },
            {
              type: 'reasoning-end',
              id: 'rs_abc123:0',
              providerMetadata: {
                openai: {
                  itemId: 'rs_abc123',
                  reasoningEncryptedContent: 'gAAAAA_final_encrypted',
                },
              },
            },
            { type: 'text-start', id: 'msg_xyz789' },
            { type: 'text-delta', id: 'msg_xyz789', delta: 'Answer.' },
            { type: 'text-end', id: 'msg_xyz789' },
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
          modelId: 'gpt-5.4-mini',
          headers: {},
          messages: [{ role: 'assistant', content: 'Answer.' }],
        },
      }),
    });

    const agent = new AISDKAgent({
      model: mockModel,
      providerOptions: { openai: { reasoningSummary: 'detailed', reasoningEffort: 'low' } },
    });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    await agent.run(createTestInput(), eventEmitter);

    const encryptedValueEvent = emittedEvents.find(e => e.type === EventType.REASONING_ENCRYPTED_VALUE);
    expect(encryptedValueEvent).toBeDefined();
    expect((encryptedValueEvent as { subtype: string }).subtype).toBe('message');
    // The final reasoning-end encrypted content should be used (not initial from reasoning-start).
    // Both reasoningEncryptedContent and itemId are preserved for multi-turn context.
    expect((encryptedValueEvent as { encryptedValue: string }).encryptedValue)
      .toBe(JSON.stringify({ openai: { reasoningEncryptedContent: 'gAAAAA_final_encrypted', itemId: 'rs_abc123' } }));
  });

  test('extracts both reasoningEncryptedContent and itemId from OpenAI providerMetadata', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'reasoning-start',
              id: 'rs_abc123:0',
              providerMetadata: {
                openai: {
                  itemId: 'rs_abc123',
                  reasoningEncryptedContent: 'gAAAAA_encrypted_content',
                },
              },
            },
            {
              type: 'reasoning-delta',
              id: 'rs_abc123:0',
              delta: 'thinking',
              providerMetadata: { openai: { itemId: 'rs_abc123' } },
            },
            {
              type: 'reasoning-end',
              id: 'rs_abc123:0',
              providerMetadata: {
                openai: {
                  itemId: 'rs_abc123',
                  reasoningEncryptedContent: 'gAAAAA_encrypted_content',
                },
              },
            },
            { type: 'text-start', id: 'msg_xyz789' },
            { type: 'text-delta', id: 'msg_xyz789', delta: 'Done.' },
            { type: 'text-end', id: 'msg_xyz789' },
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
          modelId: 'gpt-5.4-mini',
          headers: {},
          messages: [{ role: 'assistant', content: 'Done.' }],
        },
      }),
    });

    const agent = new AISDKAgent({
      model: mockModel,
      providerOptions: { openai: { reasoningSummary: 'detailed', reasoningEffort: 'low' } },
    });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    await agent.run(createTestInput(), eventEmitter);

    const encryptedValueEvent = emittedEvents.find(e => e.type === EventType.REASONING_ENCRYPTED_VALUE);
    expect(encryptedValueEvent).toBeDefined();

    // Verify both reasoningEncryptedContent and itemId are preserved for multi-turn
    const parsed = JSON.parse((encryptedValueEvent as { encryptedValue: string }).encryptedValue);
    expect(parsed).toEqual({ openai: { reasoningEncryptedContent: 'gAAAAA_encrypted_content', itemId: 'rs_abc123' } });
  });
});
