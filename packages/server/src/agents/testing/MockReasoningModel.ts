/**
 * Mock AI model for UI development and testing.
 *
 * Classifies incoming user messages by fixed keyword and returns predetermined responses,
 * including reasoning (extended thinking) blocks and multi-step tool calls.
 * Runs through the full AISDKAgent pipeline so all production code paths are exercised.
 *
 * Keywords:
 *   "long reasoning"       → long reasoning block + text
 *   "multi-step reasoning" → reasoning + tool call + reasoning + text
 *   anything else          → short reasoning + text (default)
 *
 * Usage:
 *   import { createMockReasoningModel, AISDKAgent } from '@meetsmore-oss/use-ai-server';
 *
 *   const agent = new AISDKAgent({
 *     name: 'Mock (Reasoning)',
 *     hooks: { loadConfig: () => ({ model: createMockReasoningModel() }) },
 *   });
 *
 * Enable in server-app with: USE_AI_ENABLE_MOCK_AGENT=true
 */
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai';

/** Delay between chunks in ms — slow enough to observe streaming UI */
const CHUNK_DELAY_MS = 100;

// --- Response templates ---

const REASONING_SHORT = 'The user is asking a question. Let me think about this briefly and provide a clear answer.';

const REASONING_LONG = `Let me think about this step by step.

First, I need to understand what the user is asking. They want me to calculate the factorial of 15.

The factorial of a number n (written as n!) is the product of all positive integers from 1 to n.

So 15! = 15 × 14 × 13 × 12 × 11 × 10 × 9 × 8 × 7 × 6 × 5 × 4 × 3 × 2 × 1

Let me compute this step by step:
15 × 14 = 210
210 × 13 = 2,730
2,730 × 12 = 32,760
32,760 × 11 = 360,360
360,360 × 10 = 3,603,600
3,603,600 × 9 = 32,432,400
32,432,400 × 8 = 259,459,200
259,459,200 × 7 = 1,816,214,400

So 15! = 1,307,674,368,000`;

const REASONING_STEP_1 = `This is step 1 of my reasoning. The user wants to know the current server time and also add two numbers. I'll start by calling the getServerTime tool to get the current time.`;

const REASONING_STEP_2 = `This is step 2 of my reasoning. I got the server time. Now I need to add the two numbers the user asked about. I'll use the addNumbers tool with a=42 and b=58.`;

const REASONING_STEP_3 = `This is step 3 of my reasoning. Both tool calls completed successfully. I have the current server time and the sum of 42 + 58 = 100. Let me present the results to the user.`;

const MOCK_SIGNATURE = 'mock-signature-for-testing';

// --- Chunk builders ---

function reasoningChunks(text: string, signature?: string) {
  const chunks: unknown[] = [
    { type: 'reasoning-start', id: 'r1' },
  ];
  // Small chunks for visible streaming effect
  const chunkSize = 20;
  for (let i = 0; i < text.length; i += chunkSize) {
    const isLast = i + chunkSize >= text.length;
    chunks.push({
      type: 'reasoning-delta',
      id: 'r1',
      delta: text.slice(i, i + chunkSize),
      ...(isLast && signature ? { providerMetadata: { anthropic: { signature } } } : {}),
    });
  }
  chunks.push({
    type: 'reasoning-end',
    id: 'r1',
    ...(signature ? { providerMetadata: { anthropic: { signature } } } : {}),
  });
  return chunks;
}

function textChunks(text: string) {
  // Stream text in small chunks too
  const chunks: unknown[] = [
    { type: 'text-start', id: 'text-1' },
  ];
  const chunkSize = 10;
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push({ type: 'text-delta', id: 'text-1', delta: text.slice(i, i + chunkSize) });
  }
  chunks.push({ type: 'text-end', id: 'text-1' });
  return chunks;
}

function finishChunk(reason: 'stop' | 'tool-calls' = 'stop') {
  return {
    type: 'finish',
    finishReason: reason,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  };
}

function toolCallChunks(toolCallId: string, toolName: string, input: Record<string, unknown>) {
  const inputStr = JSON.stringify(input);
  return [
    { type: 'tool-input-start', id: toolCallId, toolName },
    { type: 'tool-input-delta', id: toolCallId, delta: inputStr },
    { type: 'tool-input-end', id: toolCallId },
    { type: 'tool-call', toolCallId, toolName, input: inputStr },
  ];
}

function makeStreamResponse(chunks: unknown[], content?: unknown) {
  return {
    stream: simulateReadableStream({ chunks, chunkDelayInMs: CHUNK_DELAY_MS }),
    response: {
      id: `mock-response-${Date.now()}`,
      timestamp: new Date(),
      modelId: 'mock-reasoning-model',
      headers: {},
      messages: [{ role: 'assistant', content: content ?? '' }],
    },
  };
}

// --- Message classification ---

type ResponseType = 'reasoning-simple' | 'reasoning-long' | 'multi-step';

function classifyMessages(params: Record<string, unknown>): ResponseType {
  // AI SDK passes messages as `prompt` (array of { role, content }), not `messages`
  const prompt = (params?.prompt || []) as Array<{ role: string; content: unknown }>;
  const lastUserMsg = [...prompt].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) return 'reasoning-simple';

  // content is either a string or an array of { type: 'text', text: string }
  let text: string;
  if (typeof lastUserMsg.content === 'string') {
    text = lastUserMsg.content.toLowerCase();
  } else if (Array.isArray(lastUserMsg.content)) {
    text = (lastUserMsg.content as Array<{ type?: string; text?: string }>)
      .filter(p => p.type === 'text')
      .map(p => p.text || '')
      .join(' ')
      .toLowerCase();
  } else {
    text = '';
  }

  if (text.includes('multi-step reasoning')) return 'multi-step';
  if (text.includes('long reasoning')) return 'reasoning-long';
  return 'reasoning-simple';
}

/**
 * Create a mock model that simulates reasoning/thinking responses.
 *
 * Keyword detection (case-insensitive, in user message):
 * - `"long reasoning"` → long reasoning block + text
 * - `"multi-step reasoning"` → reasoning + tool call + reasoning + text
 * - anything else → short reasoning + text (default)
 */
export function createMockReasoningModel(): MockLanguageModelV3 {
  const doStream = async (params?: unknown) => {
    const p = (params || {}) as Record<string, unknown>;
    const responseType = classifyMessages(p);

    // For multi-step: detect phase by counting tool role messages in prompt.
    // Uses server-side tools (getServerTime, addNumbers) so it works on any page.
    // Step 1 (0 tool results): reasoning + text + tool call (getServerTime)
    // Step 2 (1 tool result):  reasoning + text + tool call (addNumbers)
    // Step 3 (2 tool results): reasoning + final summary text
    if (responseType === 'multi-step') {
      const prompt = (p.prompt || []) as Array<{ role: string }>;
      const toolResultCount = prompt.filter(m => m.role === 'tool').length;

      if (toolResultCount === 0) {
        // Step 1: reasoning + text + tool call (getServerTime)
        return makeStreamResponse(
          [
            ...reasoningChunks(REASONING_STEP_1, MOCK_SIGNATURE),
            ...textChunks('Let me check the current server time first.'),
            ...toolCallChunks('tc-ms-1', 'getServerTime', {}),
            finishChunk('tool-calls'),
          ],
          [
            { type: 'text', text: 'Let me check the current server time first.' },
            { type: 'tool-call', toolCallId: 'tc-ms-1', toolName: 'getServerTime', input: {} },
          ],
        );
      }
      if (toolResultCount === 1) {
        // Step 2: reasoning + text + tool call (addNumbers)
        return makeStreamResponse(
          [
            ...reasoningChunks(REASONING_STEP_2, MOCK_SIGNATURE),
            ...textChunks('Now let me add those numbers for you.'),
            ...toolCallChunks('tc-ms-2', 'addNumbers', { a: 42, b: 58 }),
            finishChunk('tool-calls'),
          ],
          [
            { type: 'text', text: 'Now let me add those numbers for you.' },
            { type: 'tool-call', toolCallId: 'tc-ms-2', toolName: 'addNumbers', input: { a: 42, b: 58 } },
          ],
        );
      }
      // Step 3: reasoning + final text
      return makeStreamResponse([
        ...reasoningChunks(REASONING_STEP_3, MOCK_SIGNATURE),
        ...textChunks('Here are the results: the current server time has been retrieved, and 42 + 58 = 100.'),
        finishChunk(),
      ]);
    }

    if (responseType === 'reasoning-long') {
      return makeStreamResponse([
        ...reasoningChunks(REASONING_LONG, MOCK_SIGNATURE),
        ...textChunks('15! = 1,307,674,368,000'),
        finishChunk(),
      ]);
    }

    // Default: short reasoning
    return makeStreamResponse([
      ...reasoningChunks(REASONING_SHORT, MOCK_SIGNATURE),
      ...textChunks('This is a mock response with reasoning. Try "long reasoning" or "multi-step reasoning" for other patterns.'),
      finishChunk(),
    ]);
  };

  return new MockLanguageModelV3({ doStream: doStream as never });
}
