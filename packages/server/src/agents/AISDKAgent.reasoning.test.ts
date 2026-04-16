import { describe, expect, test } from 'bun:test';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput, EventEmitter, AGUIEventExtended } from './types';
import { EventType } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { JSONValue } from 'ai';

// Helpers

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

/** Create a MockLanguageModelV3 from stream chunks and response text. */
function createMockModel(chunks: unknown[], responseText: string, modelId = 'mock-model') {
  const doStream = async () => ({
    stream: simulateReadableStream({ chunks }),
    response: {
      id: 'response-1',
      timestamp: new Date(),
      modelId,
      headers: {},
      messages: [{ role: 'assistant', content: responseText }],
    },
  });
  return new MockLanguageModelV3({ doStream: doStream as never });
}

/** Run an agent and return the collected events + result. */
async function runAgent(
  model: InstanceType<typeof MockLanguageModelV3>,
  providerOptions?: Record<string, Record<string, JSONValue>>,
) {
  const agent = new AISDKAgent({ model, providerOptions });
  const events: AGUIEventExtended[] = [];
  const emitter: EventEmitter = { emit: (e) => events.push(e) };
  const result = await agent.run(createTestInput(), emitter);
  return { events, result };
}

const FINISH_CHUNK = {
  type: 'finish' as const,
  finishReason: 'stop' as const,
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

/** Reasoning event types for filtering. */
const REASONING_EVENT_TYPES = [
  EventType.REASONING_START, EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT, EventType.REASONING_MESSAGE_END,
  EventType.REASONING_END, EventType.REASONING_ENCRYPTED_VALUE,
] as string[];

/** Reasoning + text event types for ordering checks. */
const ORDERED_EVENT_TYPES = [
  EventType.REASONING_START, EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT, EventType.REASONING_MESSAGE_END,
  EventType.REASONING_END,
  EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END,
] as string[];

// Reusable chunk sets

/** Anthropic-style: no providerMetadata on reasoning chunks (except signature on end). */
function anthropicChunks(opts: { signature?: string } = {}) {
  return [
    { type: 'reasoning-start', id: 'r1' },
    { type: 'reasoning-delta', id: 'r1', delta: 'Let me think...' },
    { type: 'reasoning-delta', id: 'r1', delta: ' about this.' },
    {
      type: 'reasoning-end',
      id: 'r1',
      ...(opts.signature ? { providerMetadata: { anthropic: { signature: opts.signature } } } : {}),
    },
    { type: 'text-start', id: 'text-1' },
    { type: 'text-delta', id: 'text-1', delta: 'Answer.' },
    { type: 'text-end', id: 'text-1' },
    FINISH_CHUNK,
  ];
}

/** OpenAI-style: providerMetadata with itemId on all chunks, encrypted content on start/end. */
function openaiChunks(opts: {
  initialEncrypted?: string;
  finalEncrypted?: string;
} = {}) {
  const initial = opts.initialEncrypted ?? 'gAAAAA_initial_encrypted';
  const final = opts.finalEncrypted ?? 'gAAAAA_final_encrypted';
  return [
    {
      type: 'reasoning-start',
      id: 'rs_abc123:0',
      providerMetadata: { openai: { itemId: 'rs_abc123', reasoningEncryptedContent: initial } },
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
      providerMetadata: { openai: { itemId: 'rs_abc123', reasoningEncryptedContent: final } },
    },
    { type: 'text-start', id: 'msg_xyz789' },
    { type: 'text-delta', id: 'msg_xyz789', delta: '2 + 2 = 4.' },
    { type: 'text-end', id: 'msg_xyz789' },
    FINISH_CHUNK,
  ];
}

describe('AISDKAgent reasoning events (Anthropic)', () => {
  test('emits REASONING_* events in correct order before text events', async () => {
    const { events, result } = await runAgent(
      createMockModel(anthropicChunks(), 'Answer.'),
      { anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } } },
    );
    expect(result.success).toBe(true);

    const content = events.filter(e => e.type === EventType.REASONING_MESSAGE_CONTENT);
    expect(content).toHaveLength(2);
    expect((content[0] as { delta: string }).delta).toBe('Let me think...');
    expect((content[1] as { delta: string }).delta).toBe(' about this.');

    const ordered = events.filter(e => ORDERED_EVENT_TYPES.includes(e.type as string)).map(e => e.type);
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
    const { events } = await runAgent(
      createMockModel(anthropicChunks({ signature: 'test-signature-123' }), 'Answer.'),
      { anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } } },
    );

    const ev = events.find(e => e.type === EventType.REASONING_ENCRYPTED_VALUE);
    expect(ev).toBeDefined();
    expect((ev as { subtype: string }).subtype).toBe('message');
    expect((ev as { encryptedValue: string }).encryptedValue)
      .toBe(JSON.stringify({ anthropic: { signature: 'test-signature-123' } }));
  });

  test('REASONING_START/END share messageId, distinct from REASONING_MESSAGE_START/END', async () => {
    const { events } = await runAgent(
      createMockModel(anthropicChunks(), 'Answer.'),
      { anthropic: { thinking: { type: 'enabled', budgetTokens: 10000 } } },
    );

    const rStart = events.find(e => e.type === EventType.REASONING_START) as { messageId: string };
    const rEnd = events.find(e => e.type === EventType.REASONING_END) as { messageId: string };
    const rmStart = events.find(e => e.type === EventType.REASONING_MESSAGE_START) as { messageId: string };
    const rmEnd = events.find(e => e.type === EventType.REASONING_MESSAGE_END) as { messageId: string };

    expect(rStart.messageId).toBe(rEnd.messageId);
    expect(rmStart.messageId).toBe(rmEnd.messageId);
    expect(rStart.messageId).not.toBe(rmStart.messageId);
  });

  test('does not emit reasoning events when no reasoning chunks are present', async () => {
    const { events } = await runAgent(
      createMockModel([
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'Hello' },
        { type: 'text-end', id: 'text-1' },
        FINISH_CHUNK,
      ], 'Hello'),
    );

    const reasoningEvents = events.filter(e => REASONING_EVENT_TYPES.includes(e.type as string));
    expect(reasoningEvents).toHaveLength(0);
  });
});

describe('AISDKAgent reasoning events (OpenAI)', () => {
  const openaiProviderOptions = { openai: { reasoningSummary: 'detailed', reasoningEffort: 'low' } };

  test('emits REASONING_* events in correct order for OpenAI reasoning model', async () => {
    const { events, result } = await runAgent(
      createMockModel(openaiChunks(), '2 + 2 = 4.', 'gpt-5.4-mini'),
      openaiProviderOptions,
    );
    expect(result.success).toBe(true);

    const content = events.filter(e => e.type === EventType.REASONING_MESSAGE_CONTENT);
    expect(content).toHaveLength(2);
    expect((content[0] as { delta: string }).delta).toBe('Let me think about this');
    expect((content[1] as { delta: string }).delta).toBe(' step by step.');

    const ordered = events.filter(e => ORDERED_EVENT_TYPES.includes(e.type as string)).map(e => e.type);
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

  test('captures reasoningEncryptedContent + itemId, using final value from reasoning-end', async () => {
    const { events } = await runAgent(
      createMockModel(
        openaiChunks({ initialEncrypted: 'gAAAAA_INITIAL', finalEncrypted: 'gAAAAA_FINAL' }),
        'Answer.',
        'gpt-5.4-mini',
      ),
      openaiProviderOptions,
    );

    const ev = events.find(e => e.type === EventType.REASONING_ENCRYPTED_VALUE);
    expect(ev).toBeDefined();
    expect((ev as { subtype: string }).subtype).toBe('message');

    // The final reasoning-end value should be used (not initial from reasoning-start).
    // Both reasoningEncryptedContent and itemId must be preserved for multi-turn context.
    const parsed = JSON.parse((ev as { encryptedValue: string }).encryptedValue);
    expect(parsed).toEqual({
      openai: { reasoningEncryptedContent: 'gAAAAA_FINAL', itemId: 'rs_abc123' },
    });
  });
});
