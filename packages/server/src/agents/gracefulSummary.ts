import { streamText, stepCountIs, type ModelMessage, type SystemModelMessage } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import { EventType } from '../types';
import type { TextMessageStartEvent, TextMessageContentEvent } from '../types';
import type { ClientSession, EventEmitter } from './types';
import type { UseAIForwardedProps, RunAgentInput } from '../types';
import type { RunSpan } from '../telemetry';
import { applyCacheBreakpoints, type CacheBreakpointFn } from './anthropicCache';
import type { LanguageModel } from 'ai';

export interface GracefulSummaryResult {
  response: Awaited<ReturnType<typeof streamText>['response']>;
  messages: ModelMessage[];
  finalText: string;
  hadContent: boolean;
  hasEmittedTextStart: boolean;
  messageId: string | null;
}

export interface GracefulSummaryParams {
  lastStepHadToolCalls: boolean;
  staticSystemMessages: SystemModelMessage[] | undefined;
  session: ClientSession;
  currentMessages: ModelMessage[];
  span: RunSpan;
  runId: string;
  originalInput: RunAgentInput;
  events: EventEmitter;
  hasEmittedTextStart: boolean;
  messageId: string | null;
  model: LanguageModel;
  cacheBreakpoint: CacheBreakpointFn | undefined;
  maxOutputTokens: number;
  temperature: number | undefined;
  maxSteps: number;
  sanitizeMessages: (messages: ModelMessage[]) => ModelMessage[];
}

/**
 * Generates a graceful summary when maxSteps is exhausted mid-tool-call chain.
 * Makes one final streamText call without tools so the model can summarize progress.
 * Returns null if no summary is needed (lastStepHadToolCalls is false).
 */
export async function generateGracefulSummaryIfNeeded(
  params: GracefulSummaryParams
): Promise<GracefulSummaryResult | null> {
  const {
    lastStepHadToolCalls,
    staticSystemMessages,
    session,
    currentMessages,
    span,
    runId,
    originalInput,
    events,
    model,
    cacheBreakpoint,
    maxOutputTokens,
    temperature,
    maxSteps,
    sanitizeMessages,
  } = params;
  let { hasEmittedTextStart, messageId } = params;

  if (!lastStepHadToolCalls) {
    return null;
  }

  const stateMessage = buildStateMessage(session.state);
  const summaryMessages: ModelMessage[] = [
    ...(staticSystemMessages || []),
    ...(stateMessage ? [stateMessage] : []),
    ...currentMessages,
    { role: 'user', content: 'max steps reached, summarize progress' },
  ];

  const summaryMessagesWithCache = applyCacheBreakpoints(summaryMessages, cacheBreakpoint, model);

  const summaryStream = span.wrap(() =>
    streamText({
      model,
      messages: summaryMessagesWithCache,
      tools: undefined,
      stopWhen: stepCountIs(1),
      maxOutputTokens,
      temperature,
      abortSignal: session.abortController?.signal,
      experimental_telemetry: span.active
        ? {
            isEnabled: true,
            functionId: 'use-ai',
            metadata: {
              sessionId: session.clientId,
              threadId: session.threadId,
              runId,
              ipAddress: session.ipAddress,
              toolCount: 0,
              stepIteration: maxSteps,
              gracefulSummary: true,
              ...((originalInput.forwardedProps as UseAIForwardedProps | undefined)?.telemetryMetadata || {}),
            },
          }
        : undefined,
    })
  );

  let finalText = '';
  let hadContent = false;

  for await (const chunk of summaryStream.fullStream) {
    if (chunk.type === 'text-delta') {
      hadContent = true;
      if (!hasEmittedTextStart) {
        messageId = uuidv4();
        events.emit<TextMessageStartEvent>({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: 'assistant',
          timestamp: Date.now(),
        });
        hasEmittedTextStart = true;
      }
      events.emit<TextMessageContentEvent>({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: messageId!,
        delta: chunk.text,
        timestamp: Date.now(),
      });
      finalText += chunk.text;
    } else if (chunk.type === 'error') {
      throw chunk.error;
    }
  }

  const summaryResponse = await summaryStream.response;

  return {
    response: summaryResponse,
    messages: sanitizeMessages(summaryResponse.messages),
    finalText,
    hadContent,
    hasEmittedTextStart,
    messageId,
  };
}

function buildStateMessage(state: unknown): SystemModelMessage | undefined {
  if (!state) return undefined;
  return {
    role: 'system',
    content: `Current application state:\n\n${JSON.stringify(state, null, 2)}`,
  };
}
