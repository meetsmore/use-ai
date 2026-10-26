/**
 * Mock AI model for UI development and testing.
 *
 * Answers from the last user message, with a reasoning (extended thinking) block that quotes it,
 * so each reply and its reasoning show which prompt they answer. Also simulates multi-step tool calls.
 * Runs through the full AISDKAgent pipeline so all production code paths are exercised.
 *
 * Keywords:
 *   "long reasoning"       → long reasoning block + text
 *   "multi-step reasoning" → reasoning + tool call + reasoning + text
 *   anything else          → short reasoning + text (default)
 *
 * Replies:
 *   "count from N to M"                   → the numbers N to M, one per line
 *   "write the single word W" (after it)  → W on the last line
 *   "reply with the single word W"        → W
 *   "previous answer"                     → the last word of the previous assistant reply
 *   anything else                         → a reply that quotes the prompt
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

/** Default delay between chunks in ms — slow enough to observe streaming UI */
const CHUNK_DELAY_MS = 100;

// --- Response templates ---

/** Largest count the mock writes out for "count from N to M". */
const MAX_COUNT = 1000;

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

function makeStreamResponse(chunks: unknown[], content?: unknown, chunkDelayInMs = CHUNK_DELAY_MS) {
  return {
    stream: simulateReadableStream({ chunks, chunkDelayInMs }),
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

type PromptMessage = { role: string; content: unknown };

/** The text parts of a message; content is either a string or an array of parts. */
function messageText(message: PromptMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return (message.content as Array<{ type?: string; text?: string }>)
    .filter(p => p.type === 'text')
    .map(p => p.text || '')
    .join(' ');
}

function lastUserText(params: Record<string, unknown>): string {
  // AI SDK passes messages as `prompt` (array of { role, content }), not `messages`
  const prompt = (params?.prompt || []) as PromptMessage[];
  return messageText([...prompt].reverse().find(m => m.role === 'user'));
}

/** Text of the last assistant reply before the last user message, or '' when there is none. */
function previousAssistantText(params: Record<string, unknown>): string {
  const prompt = (params?.prompt || []) as PromptMessage[];
  const lastUser = prompt.map(m => m.role).lastIndexOf('user');
  const previous = prompt.slice(0, Math.max(lastUser, 0)).reverse().find(m => m.role === 'assistant');
  return messageText(previous).trim();
}

function classifyMessages(params: Record<string, unknown>): ResponseType {
  const text = lastUserText(params).toLowerCase();
  if (text.includes('multi-step reasoning')) return 'multi-step';
  if (text.includes('long reasoning')) return 'reasoning-long';
  return 'reasoning-simple';
}

/** The reply to `text`, built from the request it makes. `previous` is the chat's previous reply. */
function answerFor(text: string, previous: string): string {
  const count = text.match(/count from (\d+) to (\d+)/i);
  if (count) {
    const from = Number(count[1]);
    const to = Math.min(Number(count[2]), from + MAX_COUNT - 1);
    const lines: string[] = [];
    for (let n = from; n <= to; n++) lines.push(String(n));
    const word = text.slice(count.index! + count[0].length).match(/write the single word (\w+)/i);
    if (word) lines.push(word[1]);
    return lines.join('\n');
  }
  const word = text.match(/reply with the single word (\w+)/i);
  if (word) return word[1];
  if (/previous answer/i.test(text)) {
    const words = previous.split(/\s+/).filter(Boolean);
    return words.length > 0 ? words[words.length - 1] : 'There is no previous answer in this chat.';
  }
  return `Mock reply to "${text}". Try "long reasoning" or "multi-step reasoning" for other patterns.`;
}

/** Reasoning that quotes the prompt; the long form adds one line per word of it. */
function reasoningFor(text: string, long: boolean): string {
  const lines = [`The user asked: "${text}"`, 'I will answer exactly that request.'];
  if (long) {
    text.split(/\s+/).filter(Boolean).forEach((word, index) => {
      lines.push(`Step ${index + 1}: the request contains "${word}".`);
    });
    lines.push('That covers every word of the request.');
  }
  return lines.join('\n\n');
}

/**
 * Create a mock model that simulates reasoning/thinking responses.
 *
 * The reply and its reasoning are derived from the last user message (see the file comment).
 *
 * Keyword detection (case-insensitive, in user message):
 * - `"long reasoning"` → long reasoning block + text
 * - `"multi-step reasoning"` → reasoning + tool call + reasoning + text
 * - anything else → short reasoning + text (default)
 */
export function createMockReasoningModel(options: { chunkDelayInMs?: number } = {}): MockLanguageModelV3 {
  const { chunkDelayInMs = CHUNK_DELAY_MS } = options;
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
          chunkDelayInMs,
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
          chunkDelayInMs,
        );
      }
      // Step 3: reasoning + final text
      return makeStreamResponse([
        ...reasoningChunks(REASONING_STEP_3, MOCK_SIGNATURE),
        ...textChunks('Here are the results: the current server time has been retrieved, and 42 + 58 = 100.'),
        finishChunk(),
      ], undefined, chunkDelayInMs);
    }

    const text = lastUserText(p);
    return makeStreamResponse([
      ...reasoningChunks(reasoningFor(text, responseType === 'reasoning-long'), MOCK_SIGNATURE),
      ...textChunks(answerFor(text, previousAssistantText(p))),
      finishChunk(),
    ], undefined, chunkDelayInMs);
  };

  return new MockLanguageModelV3({ doStream: doStream as never });
}
