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

    const { MockLanguageModelV3, simulateReadableStream } = await import(
      'ai/test'
    );

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
