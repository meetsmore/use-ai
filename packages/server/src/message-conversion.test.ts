import { describe, expect, test, afterAll } from 'bun:test';
import { EventType } from './types';
import type { Tool, Message as AGUIMessage, AGUIEvent } from './types';
import {
  sendRunAgent,
  sendToolResult,
  extractTextFromEvents,
} from '../test/test-utils';
import {
  createSequentialMockModel,
  TestCleanupManager,
} from '../test/integration-test-utils';
import { UseAIServer } from './server';
import { AISDKAgent } from './agents/AISDKAgent';
import { v4 as uuidv4 } from 'uuid';

const cleanup = new TestCleanupManager();

afterAll(() => {
  cleanup.cleanup();
});

/**
 * Collect events until RUN_FINISHED or RUN_ERROR is received.
 */
function collectEventsUntilDone(
  socket: ReturnType<typeof import('socket.io-client').io>,
  timeout = 10000
): Promise<{ events: unknown[]; error: boolean }> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    const timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Timeout waiting for RUN_FINISHED/RUN_ERROR. Got ${events.length} events: ${JSON.stringify(events.map((e: unknown) => (e as { type: string }).type))}`
        )
      );
    }, timeout);

    const handler = (event: unknown) => {
      events.push(event);
      const type = (event as { type: string }).type;
      if (type === EventType.RUN_FINISHED) {
        clearTimeout(timeoutId);
        socket.off('event', handler);
        resolve({ events, error: false });
      } else if (type === EventType.RUN_ERROR) {
        clearTimeout(timeoutId);
        socket.off('event', handler);
        resolve({ events, error: true });
      }
    };

    socket.on('event', handler);
  });
}

/**
 * Bug 2: Server restart causes persistent API errors from orphaned tool_result
 *
 * The server's message conversion in handleRunAgent():
 * - Uses getStringContent() for assistant messages → drops toolCalls entirely
 * - Preserves toolCallId on tool messages → creates orphaned tool_result
 *
 * This creates an invalid message sequence where a tool_result references
 * a toolCallId that doesn't exist in any preceding assistant message,
 * causing Claude API 400 errors.
 */
describe('Bug 2: Server message conversion preserves tool calls on reconnection', () => {
  test('assistant messages with toolCalls should be converted with tool-call content blocks, not text-only', async () => {
    const port = 18901;

    // Track what messages the AI SDK model receives
    let capturedPrompt: unknown[] = [];

    const { MockLanguageModelV3 } = await import('ai/test');
    const { simulateReadableStream } = await import('ai');

    const mockModel = new MockLanguageModelV3({
      doStream: async (params?: unknown) => {
        capturedPrompt = (params as { prompt?: unknown[] })?.prompt || [];

        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: 'text-1' },
              {
                type: 'text-delta' as const,
                id: 'text-1',
                delta: 'Follow-up response',
              },
              { type: 'text-end' as const, id: 'text-1' },
              {
                type: 'finish' as const,
                finishReason: 'stop' as const,
                usage: {
                  inputTokens: 100,
                  outputTokens: 50,
                  totalTokens: 150,
                },
              },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [
              { role: 'assistant', content: 'Follow-up response' },
            ],
          },
        };
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const agent = new AISDKAgent({ model: mockModel });
    const server = new UseAIServer({
      port,
      agents: { test: agent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(server);

    const ws = await cleanup.createTestClient(port);

    const threadId = uuidv4();

    // Simulate a client reconnecting with conversation history that includes
    // tool calls — this is what the client sends after a server restart.
    //
    // The client's in-memory _messages array correctly includes:
    // - assistant messages with toolCalls array
    // - tool messages with toolCallId
    const previousMessages: AGUIMessage[] = [
      {
        id: 'msg_user_1',
        role: 'user',
        content: 'Add a todo: buy groceries',
      },
      // Assistant message WITH toolCalls (how the client stores it)
      {
        id: 'msg_assistant_1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'toolu_123',
            type: 'function',
            function: {
              name: 'addTodo',
              arguments: '{"text":"buy groceries"}',
            },
          },
        ],
      } as AGUIMessage,
      // Tool result message WITH toolCallId
      {
        id: 'msg_tool_1',
        role: 'tool',
        content: '{"success":true,"message":"Todo added"}',
        toolCallId: 'toolu_123',
      } as AGUIMessage,
      // Final assistant text response
      {
        id: 'msg_assistant_2',
        role: 'assistant',
        content: "I've added 'buy groceries' to your todo list.",
      },
    ];

    // Send a follow-up message with the full history (first run after reconnection)
    sendRunAgent(ws, {
      prompt: 'What todos do I have?',
      tools: [],
      threadId,
      previousMessages,
    });

    const { events, error } = await collectEventsUntilDone(ws);

    // The request should succeed, not error
    expect(error).toBe(false);

    // Verify the messages sent to the AI model have proper tool-call blocks
    // on assistant messages (not just text content)
    expect(capturedPrompt.length).toBeGreaterThan(0);

    const assistantMessages = capturedPrompt.filter(
      (msg: unknown) => (msg as { role: string }).role === 'assistant'
    );
    const toolMessages = capturedPrompt.filter(
      (msg: unknown) => (msg as { role: string }).role === 'tool'
    );

    // Should have 2 assistant messages and 1 tool message
    expect(assistantMessages).toHaveLength(2);
    expect(toolMessages).toHaveLength(1);

    // Critical assertion: The first assistant message (which had tool calls)
    // should have content that includes tool-call blocks, not just text.
    // Currently FAILS: getStringContent() converts it to an empty string.
    const firstAssistant = assistantMessages[0] as {
      role: string;
      content: unknown;
    };

    // AI SDK format for assistant messages with tool calls uses an array of
    // content blocks: [{ type: 'tool-call', toolCallId, toolName, args }]
    expect(Array.isArray(firstAssistant.content)).toBe(true);

    const contentBlocks = firstAssistant.content as unknown[];
    const toolCallBlocks = contentBlocks.filter(
      (block: unknown) => (block as { type: string }).type === 'tool-call'
    );
    expect(toolCallBlocks).toHaveLength(1);

    const toolCallBlock = toolCallBlocks[0] as {
      type: string;
      toolCallId: string;
      toolName: string;
    };
    expect(toolCallBlock.toolCallId).toBe('toolu_123');
    expect(toolCallBlock.toolName).toBe('addTodo');

    // The tool message should reference the same toolCallId
    const toolMsg = toolMessages[0] as {
      role: string;
      content: unknown[];
    };
    const toolResult = toolMsg.content[0] as {
      type: string;
      toolCallId: string;
      toolName: string;
    };
    expect(toolResult.toolCallId).toBe('toolu_123');
    expect(toolResult.toolName).toBe('addTodo');

    ws.disconnect();
  });

  test('conversation should remain valid across multiple messages after reconnection with tool history', async () => {
    const port = 18902;

    const mockModel = createSequentialMockModel([
      { text: 'First follow-up' },
      { text: 'Second follow-up' },
    ]);

    const agent = new AISDKAgent({ model: mockModel });
    const server = new UseAIServer({
      port,
      agents: { test: agent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(server);

    const ws = await cleanup.createTestClient(port);

    const threadId = uuidv4();

    // Client reconnects with tool history
    const previousMessages: AGUIMessage[] = [
      {
        id: 'msg_user_1',
        role: 'user',
        content: 'Add a todo: buy groceries',
      },
      {
        id: 'msg_assistant_1',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'toolu_123',
            type: 'function',
            function: {
              name: 'addTodo',
              arguments: '{"text":"buy groceries"}',
            },
          },
        ],
      } as AGUIMessage,
      {
        id: 'msg_tool_1',
        role: 'tool',
        content: '{"success":true}',
        toolCallId: 'toolu_123',
      } as AGUIMessage,
      {
        id: 'msg_assistant_2',
        role: 'assistant',
        content: 'Done! Added buy groceries.',
      },
    ];

    // First follow-up after reconnection
    sendRunAgent(ws, {
      prompt: 'What todos do I have?',
      tools: [],
      threadId,
      previousMessages,
    });

    const result1 = await collectEventsUntilDone(ws);

    // Should succeed, not error from orphaned tool_result
    expect(result1.error).toBe(false);
    const text1 = extractTextFromEvents(
      result1.events as AGUIEvent[]
    );
    expect(text1).toBe('First follow-up');

    // Second follow-up — the server's conversation history from the first
    // run should still be valid. If the first run stored broken history
    // (assistant without tool-call blocks + orphaned tool-result), this
    // second call would fail with the real API.
    sendRunAgent(ws, {
      prompt: 'Add another todo: walk the dog',
      tools: [],
      threadId,
      previousMessages: [
        ...previousMessages,
        {
          id: uuidv4(),
          role: 'user',
          content: 'What todos do I have?',
        },
        {
          id: uuidv4(),
          role: 'assistant',
          content: 'First follow-up',
        },
      ],
    });

    const result2 = await collectEventsUntilDone(ws);

    // Should succeed, not error
    expect(result2.error).toBe(false);
    const text2 = extractTextFromEvents(
      result2.events as AGUIEvent[]
    );
    expect(text2).toBe('Second follow-up');

    ws.disconnect();
  });
});

describe('Reasoning parts roundtrip through message conversion', () => {
  test('assistant messages with reasoningParts should include reasoning content blocks when sent to model', async () => {
    const port = 18904;

    // Track what messages the AI SDK model receives
    let capturedMessages: unknown[] = [];

    const { MockLanguageModelV3 } = await import('ai/test');
    const { simulateReadableStream } = await import('ai');

    const mockModel = new MockLanguageModelV3({
      doStream: async ({ prompt }) => {
        capturedMessages = prompt;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Response' },
              { type: 'text-end', id: 'text-1' },
              { type: 'finish', finishReason: 'stop' as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [{ role: 'assistant', content: 'Response' }],
          },
        };
      },
    });

    const agent = new AISDKAgent({ model: mockModel });
    const server = new UseAIServer({
      agents: { test: agent },
      defaultAgent: 'test',
      port,
    });
    cleanup.trackServer(server);

    const { io } = await import('socket.io-client');
    const ws = io(`http://localhost:${port}`, { transports: ['websocket'] });
    cleanup.trackSocket(ws);
    await new Promise<void>((resolve) => ws.on('connect', resolve));

    const threadId = uuidv4();

    // Send a message that includes reasoning parts from a previous turn
    sendRunAgent(ws, {
      prompt: 'Follow up question',
      tools: [],
      threadId,
      previousMessages: [
        { id: uuidv4(), role: 'user', content: 'What is 2+2?' },
        {
          id: uuidv4(),
          role: 'assistant',
          content: '4',
          reasoningParts: [
            { text: 'Let me think: 2+2=4', encryptedValue: JSON.stringify({ anthropic: { signature: 'test-sig-abc' } }) },
          ],
        } as AGUIMessage & { reasoningParts: Array<{ text: string; encryptedValue?: string }> },
      ],
    });

    await collectEventsUntilDone(ws);

    // Verify that the model received the reasoning content blocks
    const assistantMessages = (capturedMessages as Array<{ role: string; content: unknown }>)
      .filter(m => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

    // The first assistant message should have reasoning + text content blocks
    const firstAssistant = assistantMessages[0];
    expect(Array.isArray(firstAssistant.content)).toBe(true);
    const contentBlocks = firstAssistant.content as Array<{ type: string; text?: string; providerMetadata?: unknown }>;

    const reasoningBlock = contentBlocks.find(b => b.type === 'reasoning');
    expect(reasoningBlock).toBeDefined();
    expect(reasoningBlock!.text).toBe('Let me think: 2+2=4');

    const textBlock = contentBlocks.find(b => b.type === 'text');
    expect(textBlock).toBeDefined();
    expect(textBlock!.text).toBe('4');

    ws.disconnect();
  });

  test('reasoning signature is converted from encryptedValue to providerOptions for API round-trip', async () => {
    const port = 18905;

    let capturedMessages: unknown[] = [];

    const { MockLanguageModelV3 } = await import('ai/test');
    const { simulateReadableStream } = await import('ai');

    const mockModel = new MockLanguageModelV3({
      doStream: async ({ prompt }) => {
        capturedMessages = prompt;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'OK' },
              { type: 'text-end', id: 'text-1' },
              { type: 'finish', finishReason: 'stop' as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [{ role: 'assistant', content: 'OK' }],
          },
        };
      },
    });

    const agent = new AISDKAgent({ model: mockModel });
    const server = new UseAIServer({
      agents: { test: agent },
      defaultAgent: 'test',
      port,
    });
    cleanup.trackServer(server);

    const { io } = await import('socket.io-client');
    const ws = io(`http://localhost:${port}`, { transports: ['websocket'] });
    cleanup.trackSocket(ws);
    await new Promise<void>((resolve) => ws.on('connect', resolve));

    const threadId = uuidv4();
    const testSignature = 'EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pk...';

    sendRunAgent(ws, {
      prompt: 'What number did you think of?',
      tools: [],
      threadId,
      previousMessages: [
        { id: uuidv4(), role: 'user', content: 'Think of a number' },
        {
          id: uuidv4(),
          role: 'assistant',
          content: 'OK',
          reasoningParts: [
            {
              text: 'I will think of the number 42.',
              encryptedValue: JSON.stringify({ anthropic: { signature: testSignature } }),
            },
          ],
        } as AGUIMessage & { reasoningParts: Array<{ text: string; encryptedValue?: string }> },
      ],
    });

    await collectEventsUntilDone(ws);

    // Find the assistant message with reasoning
    const assistantMessages = (capturedMessages as Array<{ role: string; content: unknown; providerOptions?: unknown }>)
      .filter(m => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

    const firstAssistant = assistantMessages[0];
    const contentBlocks = firstAssistant.content as Array<{
      type: string;
      text?: string;
      providerOptions?: Record<string, unknown>;
      providerMetadata?: Record<string, unknown>;
    }>;

    const reasoningBlock = contentBlocks.find(b => b.type === 'reasoning');
    expect(reasoningBlock).toBeDefined();

    // The signature must be in providerOptions (what AI SDK sends to the API),
    // NOT in providerMetadata (which is deserialized from encryptedValue).
    // Without this conversion, the Anthropic API cannot verify the thinking block
    // and reasoning context is lost across turns.
    expect(reasoningBlock!.providerOptions).toEqual({
      anthropic: { signature: testSignature },
    });

    // providerMetadata should NOT be present (it's the input format, not the output)
    expect(reasoningBlock!.providerMetadata).toBeUndefined();

    ws.disconnect();
  });

  test('Gemini thoughtSignature on tool calls is converted from encryptedValue to providerOptions for API round-trip', async () => {
    const port = 18906;

    let capturedMessages: unknown[] = [];

    const { MockLanguageModelV3 } = await import('ai/test');
    const { simulateReadableStream } = await import('ai');

    const mockModel = new MockLanguageModelV3({
      doStream: async ({ prompt }) => {
        capturedMessages = prompt;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'The result is 12.' },
              { type: 'text-end', id: 'text-1' },
              { type: 'finish', finishReason: 'stop' as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
            ],
          }),
          response: {
            id: 'response-1',
            timestamp: new Date(),
            modelId: 'mock-model',
            headers: {},
            messages: [{ role: 'assistant', content: 'The result is 12.' }],
          },
        };
      },
    });

    const agent = new AISDKAgent({ model: mockModel });
    const server = new UseAIServer({
      agents: { test: agent },
      defaultAgent: 'test',
      port,
    });
    cleanup.trackServer(server);

    const { io } = await import('socket.io-client');
    const ws = io(`http://localhost:${port}`, { transports: ['websocket'] });
    cleanup.trackSocket(ws);
    await new Promise<void>((resolve) => ws.on('connect', resolve));

    const threadId = uuidv4();
    const testThoughtSignature = 'test-thought-signature-abc';

    sendRunAgent(ws, {
      prompt: 'What was the result?',
      tools: [],
      threadId,
      previousMessages: [
        { id: uuidv4(), role: 'user', content: 'Add 5 and 7 using the add tool.' },
        {
          id: uuidv4(),
          role: 'assistant',
          content: 'I need to add 5 and 7.',
          toolCalls: [
            {
              id: 'tc_gemini_abc',
              type: 'function',
              function: { name: 'add', arguments: '{"a":5,"b":7}' },
              encryptedValue: JSON.stringify({ google: { thoughtSignature: testThoughtSignature } }),
            },
          ],
        } as AGUIMessage & { toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string }; encryptedValue?: string }> },
        {
          id: uuidv4(),
          role: 'tool',
          content: '{"result":12}',
          toolCallId: 'tc_gemini_abc',
          tool_call_id: 'tc_gemini_abc',
        } as unknown as AGUIMessage,
      ],
    });

    await collectEventsUntilDone(ws);

    // Find the assistant message with tool calls
    const assistantMessages = (capturedMessages as Array<{ role: string; content: unknown }>)
      .filter(m => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

    const firstAssistant = assistantMessages[0];
    const contentBlocks = firstAssistant.content as Array<{
      type: string;
      toolCallId?: string;
      providerOptions?: Record<string, unknown>;
      providerMetadata?: Record<string, unknown>;
    }>;

    // The tool-call content block should have providerOptions with Google thoughtSignature
    const toolCallBlock = contentBlocks.find(b => b.type === 'tool-call');
    expect(toolCallBlock).toBeDefined();
    expect(toolCallBlock!.providerOptions).toEqual({
      google: { thoughtSignature: testThoughtSignature },
    });
    // providerMetadata should NOT be present (it's the input format)
    expect(toolCallBlock!.providerMetadata).toBeUndefined();

    // Find the tool result message
    const toolMessages = (capturedMessages as Array<{ role: string; content: unknown }>)
      .filter(m => m.role === 'tool');
    expect(toolMessages.length).toBeGreaterThanOrEqual(1);

    const toolMessage = toolMessages[0];
    const toolResultBlocks = toolMessage.content as Array<{
      type: string;
      providerOptions?: Record<string, unknown>;
      providerMetadata?: Record<string, unknown>;
    }>;

    // The tool-result content block should also have providerOptions with Google thoughtSignature
    const toolResultBlock = toolResultBlocks.find(b => b.type === 'tool-result');
    expect(toolResultBlock).toBeDefined();
    expect(toolResultBlock!.providerOptions).toEqual({
      google: { thoughtSignature: testThoughtSignature },
    });
    expect(toolResultBlock!.providerMetadata).toBeUndefined();

    ws.disconnect();
  });
});
