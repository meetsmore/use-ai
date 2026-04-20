import { describe, expect, test } from 'bun:test';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput, EventEmitter, AGUIEventExtended } from './types';
import { EventType } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { JSONValue } from 'ai';

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

describe('AISDKAgent reasoning events (OpenAI)', () => {
  function createOpenAIMockModel(chunks: unknown[], responseText: string) {
    const doStream = async () => ({
      stream: simulateReadableStream({ chunks }),
      response: {
        id: 'response-1',
        timestamp: new Date(),
        modelId: 'gpt-5.4-mini',
        headers: {},
        messages: [{ role: 'assistant', content: responseText }],
      },
    });
    return new MockLanguageModelV3({ doStream: doStream as never });
  }

  const openaiProviderOptions: Record<string, Record<string, JSONValue>> = {
    openai: { reasoningSummary: 'detailed', reasoningEffort: 'low' },
  };

  function openaiChunks(opts: { initialEncrypted?: string; finalEncrypted?: string } = {}) {
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
      {
        type: 'finish' as const,
        finishReason: 'stop' as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ];
  }

  test('emits REASONING_* events in correct order for OpenAI reasoning model', async () => {
    const mockModel = createOpenAIMockModel(openaiChunks(), '2 + 2 = 4.');
    const agent = new AISDKAgent({ model: mockModel, providerOptions: openaiProviderOptions });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };
    const result = await agent.run(createTestInput(), eventEmitter);
    expect(result.success).toBe(true);

    const content = emittedEvents.filter(e => e.type === EventType.REASONING_MESSAGE_CONTENT);
    expect(content).toHaveLength(2);
    expect((content[0] as { delta: string }).delta).toBe('Let me think about this');
    expect((content[1] as { delta: string }).delta).toBe(' step by step.');

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

  test('captures reasoningEncryptedContent + itemId, using final value from reasoning-end', async () => {
    const mockModel = createOpenAIMockModel(
      openaiChunks({ initialEncrypted: 'gAAAAA_INITIAL', finalEncrypted: 'gAAAAA_FINAL' }),
      'Answer.',
    );
    const agent = new AISDKAgent({ model: mockModel, providerOptions: openaiProviderOptions });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };
    await agent.run(createTestInput(), eventEmitter);

    const ev = emittedEvents.find(e => e.type === EventType.REASONING_ENCRYPTED_VALUE);
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

describe('AISDKAgent reasoning events (Google/Gemini)', () => {
  /**
   * Gemini models attach thoughtSignature to tool call chunks rather than reasoning chunks.
   * No reasoning-start/delta/end events are emitted. The signature appears on
   * tool-input-start and tool-call chunks.
   *
   * Uses server-side tools (_server.execute) so AI SDK can execute tool calls
   * without waiting for a client response.
   */

  const thoughtSignature = 'test-thought-signature';

  const addTool = {
    name: 'add',
    description: 'Add two numbers',
    parameters: { type: 'object' as const, properties: {} },
    _server: { execute: () => ({ ok: true }) },
  };

  function createGeminiTestInput() {
    const threadId = uuidv4();
    const runId = uuidv4();
    return {
      session: {
        socket: {} as never,
        clientId: 'client-1',
        threadId: 'thread-1',
        tools: [] as never[],
        state: null,
        pendingToolCalls: new Map(),
        pendingToolApprovals: new Map(),
        ipAddress: '127.0.0.1',
      },
      runId,
      messages: [{ role: 'user' as const, content: 'Add 5 and 7' }],
      tools: [addTool],
      state: null,
      originalInput: {
        threadId,
        runId,
        messages: [{ id: uuidv4(), role: 'user' as const, content: 'Add 5 and 7' }],
        tools: [],
        state: null,
        context: [],
        forwardedProps: {},
      },
    };
  }

  function createGeminiMockModel(chunks: unknown[]) {
    return new MockLanguageModelV3({
      doStream: (async () => ({
        stream: simulateReadableStream({ chunks }),
        response: {
          id: 'response-1',
          timestamp: new Date(),
          modelId: 'google/gemini-3.1-flash-lite-preview',
          headers: {},
          messages: [{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc_gemini_123', toolName: 'add', input: {} }] }],
        },
      })) as never,
    });
  }

  function geminiToolCallChunks(sig: string = thoughtSignature) {
    return [
      {
        type: 'tool-input-start',
        id: 'tc_gemini_123',
        toolName: 'add',
        providerMetadata: { google: { thoughtSignature: sig } },
      },
      { type: 'tool-input-delta', id: 'tc_gemini_123', delta: '{}' },
      { type: 'tool-input-end', id: 'tc_gemini_123' },
      {
        type: 'tool-call',
        toolCallId: 'tc_gemini_123',
        toolName: 'add',
        input: '{}',
        providerMetadata: { google: { thoughtSignature: sig } },
      },
      {
        type: 'finish' as const,
        finishReason: 'tool-calls' as const,
        usage: { inputTokens: 36, outputTokens: 50, totalTokens: 200, reasoningTokens: 114 },
      },
    ];
  }

  test('captures thoughtSignature from tool call chunks and emits REASONING_ENCRYPTED_VALUE with subtype tool-call', async () => {
    const mockModel = createGeminiMockModel(geminiToolCallChunks());
    const agent = new AISDKAgent({ model: mockModel, maxSteps: 1 });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };
    const result = await agent.run(createGeminiTestInput(), eventEmitter);
    expect(result.success).toBe(true);

    // Verify REASONING_ENCRYPTED_VALUE is emitted with subtype 'tool-call'
    const encryptedEvents = emittedEvents.filter(e => e.type === EventType.REASONING_ENCRYPTED_VALUE);
    expect(encryptedEvents.length).toBeGreaterThanOrEqual(1);

    const ev = encryptedEvents[0] as { subtype: string; entityId: string; encryptedValue: string };
    expect(ev.subtype).toBe('tool-call');
    expect(ev.entityId).toBe('tc_gemini_123');

    const parsed = JSON.parse(ev.encryptedValue);
    expect(parsed).toEqual({
      google: { thoughtSignature },
    });
  });

  test('does not emit reasoning block events (no reasoning-start/delta/end) for Gemini', async () => {
    const mockModel = createGeminiMockModel(geminiToolCallChunks());
    const agent = new AISDKAgent({ model: mockModel, maxSteps: 1 });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };
    await agent.run(createGeminiTestInput(), eventEmitter);

    // Gemini does not emit reasoning-start/delta/end — thinking is internal
    const reasoningBlockEvents = emittedEvents.filter(e =>
      [
        EventType.REASONING_START,
        EventType.REASONING_MESSAGE_START,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_END,
        EventType.REASONING_END,
      ].includes(e.type as EventType)
    );
    expect(reasoningBlockEvents).toHaveLength(0);
  });

  test('emits REASONING_ENCRYPTED_VALUE after TOOL_CALL_END', async () => {
    const mockModel = createGeminiMockModel(geminiToolCallChunks());
    const agent = new AISDKAgent({ model: mockModel, maxSteps: 1 });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };
    await agent.run(createGeminiTestInput(), eventEmitter);

    const relevantTypes = [
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_END,
      EventType.REASONING_ENCRYPTED_VALUE,
    ] as string[];
    const ordered = emittedEvents
      .filter(e => relevantTypes.includes(e.type as string))
      .map(e => e.type);

    // REASONING_ENCRYPTED_VALUE should follow TOOL_CALL_END
    expect(ordered).toContain(EventType.TOOL_CALL_START);
    expect(ordered).toContain(EventType.TOOL_CALL_END);
    expect(ordered).toContain(EventType.REASONING_ENCRYPTED_VALUE);

    const tcEndIdx = ordered.indexOf(EventType.TOOL_CALL_END);
    const encIdx = ordered.indexOf(EventType.REASONING_ENCRYPTED_VALUE);
    expect(encIdx).toBeGreaterThan(tcEndIdx);
  });

  test('does not emit REASONING_ENCRYPTED_VALUE when no thoughtSignature on tool calls', async () => {
    const chunks = [
      { type: 'tool-input-start', id: 'tc_no_sig', toolName: 'add' },
      { type: 'tool-input-delta', id: 'tc_no_sig', delta: '{}' },
      { type: 'tool-input-end', id: 'tc_no_sig' },
      { type: 'tool-call', toolCallId: 'tc_no_sig', toolName: 'add', input: '{}' },
      { type: 'finish' as const, finishReason: 'tool-calls' as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    ];

    const mockModel = new MockLanguageModelV3({
      doStream: (async () => ({
        stream: simulateReadableStream({ chunks }),
        response: {
          id: 'response-1', timestamp: new Date(), modelId: 'mock-model', headers: {},
          messages: [{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc_no_sig', toolName: 'add', input: {} }] }],
        },
      })) as never,
    });
    const agent = new AISDKAgent({ model: mockModel, maxSteps: 1 });

    const emittedEvents: AGUIEventExtended[] = [];
    const eventEmitter: EventEmitter = { emit: (event) => emittedEvents.push(event) };
    await agent.run(createGeminiTestInput(), eventEmitter);

    const encryptedEvents = emittedEvents.filter(e => e.type === EventType.REASONING_ENCRYPTED_VALUE);
    expect(encryptedEvents).toHaveLength(0);
  });
});
