import type { ModelMessage, ToolModelMessage } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import {
  transformedFileToText,
  type TextContent,
  type ImageContent,
  type FileContent,
  type TransformedFileContent,
} from '@meetsmore-oss/use-ai-core';
import type { Message } from './types';

/**
 * A content block in an incoming AG-UI message.
 * The client sends the use-ai multimodal parts. Other block types can also arrive,
 * because the input is not trusted, so the last member accepts any block.
 */
type ContentBlock =
  | TextContent
  | ImageContent
  | FileContent
  | TransformedFileContent
  | { type: string; [key: string]: unknown };

type MessageContent = string | ContentBlock[] | Record<string, unknown> | undefined;

// AI SDK content part types (matching AI SDK v6 UserContent)
type AISDKTextPart = { type: 'text'; text: string };
type AISDKImagePart = { type: 'image'; image: string };
type AISDKFilePart = { type: 'file'; data: string; mediaType: string };
type AISDKContentPart = AISDKTextPart | AISDKImagePart | AISDKFilePart;

type ToolMessage = Message & {
  role: 'tool';
  tool_call_id?: string;
  toolCallId?: string;
};

/** A tool call as the client sends it on an assistant message. */
type IncomingToolCall = {
  id: string;
  type: string;
  function: { name: string; arguments: string };
  encryptedValue?: string;
};

/** A reasoning part as the client sends it on an assistant message. */
type IncomingReasoningPart = {
  text: string;
  encryptedValue?: string;
};

type AssistantContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown; providerMetadata?: Record<string, unknown> }
  | { type: 'reasoning'; text: string; providerMetadata?: Record<string, unknown> };

/** The result of {@link safeJsonParse}. */
export type SafeJsonParseResult = { ok: true; value: unknown } | { ok: false };

/**
 * Parses JSON text and does not throw.
 *
 * @param text - The JSON text to parse
 * @returns `{ ok: true, value }` if the text is valid JSON, otherwise `{ ok: false }`
 */
export function safeJsonParse(text: string): SafeJsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Converts a serialized `encryptedValue` back to provider metadata.
 * The value is opaque provider data (for example an Anthropic signature), so it is passed on unchanged.
 * Malformed JSON gives `undefined`.
 */
function parseProviderMetadata(encryptedValue: string | undefined): Record<string, unknown> | undefined {
  if (!encryptedValue) return undefined;
  const parsed = safeJsonParse(encryptedValue);
  return parsed.ok ? (parsed.value as Record<string, unknown>) : undefined;
}

function isToolMessage(msg: Message): msg is ToolMessage {
  return msg.role === 'tool';
}

/**
 * Gets the text of message content as one string (for assistant messages and tool results).
 * An array gives the joined text blocks. An object gives its JSON.
 */
export function getStringContent(content: MessageContent): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is TextContent => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }
  if (typeof content === 'object') {
    return JSON.stringify(content);
  }
  return '';
}

/**
 * Converts AG-UI content to AI SDK user content. Multimodal parts are kept.
 * Content with only one text part becomes a plain string.
 */
export function convertToAISDKContent(content: MessageContent): string | AISDKContentPart[] {
  if (!content) return '';
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const parts: AISDKContentPart[] = [];

    for (const block of content) {
      if (block.type === 'text' && 'text' in block) {
        parts.push({ type: 'text', text: block.text as string });
      } else if (block.type === 'image_url' && 'url' in block) {
        // AG-UI uses 'url', AI SDK uses 'image'
        parts.push({ type: 'image', image: block.url as string });
      } else if (block.type === 'file_url' && 'url' in block) {
        // AG-UI uses 'url' and 'mimeType', AI SDK uses 'data' and 'mediaType'
        parts.push({
          type: 'file',
          data: block.url as string,
          mediaType: (block.mimeType as string) || 'application/octet-stream',
        });
      } else if (block.type === 'transformed_file' && 'text' in block) {
        // Transformed file from client-side FileTransformer - convert to text
        const originalFile = (block as { originalFile?: Partial<TransformedFileContent['originalFile']> }).originalFile;
        parts.push({
          type: 'text',
          text: transformedFileToText({
            text: block.text as string,
            originalFile: {
              name: originalFile?.name || 'file',
              mimeType: originalFile?.mimeType || 'application/octet-stream',
            },
          }),
        });
      }
    }

    // If only text parts, return as string for simplicity
    if (parts.length === 1 && parts[0].type === 'text') {
      return parts[0].text;
    }

    return parts.length > 0 ? parts : '';
  }

  if (typeof content === 'object') {
    return JSON.stringify(content);
  }
  return '';
}

function toAssistantModelMessage(msg: Message): ModelMessage {
  const textContent = getStringContent(msg.content);

  // Reasoning parts (extended thinking) are persisted from previous runs.
  // encryptedValue contains JSON-serialized provider metadata (for example an Anthropic signature).
  // AISDKAgent.reasoningContentSchema transforms it to providerOptions
  // (the format the AI SDK sends to the Anthropic API for signature verification).
  const reasoningParts = (msg as { reasoningParts?: IncomingReasoningPart[] }).reasoningParts;

  // AG-UI toolCalls on the message (sent by client on reconnection)
  const toolCalls = (msg as { toolCalls?: IncomingToolCall[] }).toolCalls;

  const hasReasoning = reasoningParts && reasoningParts.length > 0;
  const hasToolCalls = toolCalls && toolCalls.length > 0;

  if (!hasReasoning && !hasToolCalls) {
    return { role: 'assistant', content: textContent };
  }

  const content: AssistantContentPart[] = [];

  // Add reasoning parts first (before text/tool-calls) for multi-turn context
  if (hasReasoning) {
    for (const rp of reasoningParts) {
      const providerMetadata = parseProviderMetadata(rp.encryptedValue);
      content.push({
        type: 'reasoning',
        text: rp.text,
        ...(providerMetadata ? { providerMetadata } : {}),
      });
    }
  }

  if (textContent) {
    content.push({ type: 'text', text: textContent });
  }

  if (hasToolCalls) {
    for (const tc of toolCalls) {
      const parsedInput = safeJsonParse(tc.function.arguments);
      // encryptedValue carries the Gemini thoughtSignature
      const providerMetadata = parseProviderMetadata(tc.encryptedValue);
      content.push({
        type: 'tool-call',
        toolCallId: tc.id,
        toolName: tc.function.name,
        input: parsedInput.ok ? parsedInput.value : tc.function.arguments,
        ...(providerMetadata ? { providerMetadata } : {}),
      });
    }
  }

  return { role: 'assistant', content };
}

/**
 * @param messages - All messages of the run
 * @param msgIndex - The index of `msg` in `messages`
 */
function toToolModelMessage(msg: ToolMessage, messages: Message[], msgIndex: number): ToolModelMessage {
  // AI SDK v6 tool output is a discriminated union: { type: "json"|"text", value }
  const content = getStringContent(msg.content);
  const parsed = safeJsonParse(content);
  const output: { type: 'json'; value: unknown } | { type: 'text'; value: string } = parsed.ok
    ? { type: 'json', value: parsed.value }
    : { type: 'text', value: content };
  const toolCallId = msg.tool_call_id || msg.toolCallId || uuidv4();

  // AG-UI ToolMessage has no toolName field. Resolve it by scanning back
  // through the preceding assistant messages' toolCalls.
  // Also look up encryptedValue for Gemini thoughtSignature propagation to tool results.
  let toolName: string | undefined;
  let toolEncryptedValue: string | undefined;
  for (let i = msgIndex - 1; i >= 0; i--) {
    const prevToolCalls = (messages[i] as { toolCalls?: IncomingToolCall[] }).toolCalls;
    if (prevToolCalls) {
      const match = prevToolCalls.find(tc => tc.id === toolCallId);
      if (match) {
        toolName = match.function.name;
        toolEncryptedValue = match.encryptedValue;
        break;
      }
    }
  }

  // Gemini requires thoughtSignature on both tool-call and tool-result parts
  const providerMetadata = parseProviderMetadata(toolEncryptedValue);

  return {
    role: 'tool' as const,
    content: [
      {
        type: 'tool-result' as const,
        toolCallId,
        toolName: toolName || 'unknown',
        output,
        ...(providerMetadata ? { providerMetadata } : {}),
      },
    ],
  } as ToolModelMessage;
}

/**
 * Converts AG-UI messages to AI SDK `ModelMessage[]`.
 * This function is pure, except that a tool message without a tool call ID gets a new UUID.
 *
 * - User messages keep their multimodal parts.
 * - Assistant messages keep reasoning parts and tool calls (sent by the client on reconnection).
 * - Tool messages get the tool name from the matching tool call in an earlier message.
 * - Other roles become user messages.
 */
export function toModelMessages(messages: Message[]): ModelMessage[] {
  return messages.map((msg, msgIndex): ModelMessage => {
    if (msg.role === 'user') {
      return { role: 'user', content: convertToAISDKContent(msg.content) };
    }
    if (msg.role === 'assistant') {
      return toAssistantModelMessage(msg);
    }
    if (isToolMessage(msg)) {
      return toToolModelMessage(msg, messages, msgIndex);
    }
    return { role: 'user', content: convertToAISDKContent(msg.content) };
  });
}
