import { streamText, jsonSchema, LanguageModel, stepCountIs, type ModelMessage, type SystemModelMessage } from 'ai';
import type { AttributeValue } from '@opentelemetry/api';
import type { JSONSchema7 } from 'json-schema';
import { startRunSpan, flushTelemetry as flushAllTelemetry } from '../telemetry';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { Agent, AgentInput, EventEmitter, AgentResult, ClientSession } from './types';
import type { ToolDefinition, UseAIForwardedProps } from '../types';
import type { RemoteToolDefinition } from '../mcp';
import { isUseAIInternalResponse } from '../mcp/useAIInternalResponse';
import { isMcpConfirmationResponse, handleMcpConfirmation } from '../mcp/mcpConfirmation';
import { EventType, ErrorCode } from '../types';
import { createClientToolExecutor } from '../utils/toolConverter';
import { isRemoteTool, isServerTool } from '../utils/toolFilters';
import { createServerToolExecutor } from '../tools/serverToolExecutor';
import type {
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  StateSnapshotEvent,
  MessagesSnapshotEvent,
  StepStartedEvent,
  StepFinishedEvent,
  ToolCallStartExtensions,
} from '../types';
import { logger } from '../logger';
import { applyCacheBreakpoints, type CacheBreakpointFn } from './anthropicCache';

import { getToolAnnotations } from '../utils';
import { toolNeedsApproval, createApprovalWrapper, type ToolArguments, type ToolResult } from './toolApproval';

/**
 * API error structure for error handling
 */
interface APIError {
  statusCode?: number;
  data?: {
    error?: {
      type?: string;
    };
  };
  message?: string;
}


/**
 * Configuration for AISDKAgent.
 */
export interface AISDKAgentConfig {
  /**
   * AI SDK Language Model (works with any provider).
   *
   * @example
   * ```typescript
   * import { anthropic } from '@ai-sdk/anthropic';
   * import { openai } from '@ai-sdk/openai';
   * import { google } from '@ai-sdk/google';
   *
   * // With Anthropic Claude
   * { model: anthropic('claude-3-5-sonnet-20241022') }
   *
   * // With OpenAI GPT
   * { model: openai('gpt-4-turbo') }
   *
   * // With Google Gemini
   * { model: google('gemini-pro') }
   * ```
   */
  model: LanguageModel;

  /**
   * Agent name for identification (defaults to 'ai-sdk').
   * Use this to differentiate multiple AI SDK agents.
   */
  name?: string;

  /**
   * Optional annotation/description for the agent.
   * Displayed in the use-ai agent selector UI to help users understand
   * the agent's capabilities or purpose.
   *
   * @example
   * ```typescript
   * { annotation: 'Fast responses for simple tasks' }
   * { annotation: 'Deep thinking mode for complex reasoning' }
   * ```
   */
  annotation?: string;

  /**
   * Optional system prompt to configure the agent's behavior.
   * This prompt is set on the backend and not exposed to the frontend,
   * making it suitable for sensitive instructions.
   *
   * Can be a string, a function returning a string, or an async function
   * returning a Promise<string>. Use a function when the prompt needs to
   * be dynamically resolved (e.g., fetched from Langfuse or other external
   * sources) so updates take effect immediately without server restart.
   *
   * When both this and the runtime systemPrompt (from AgentInput) are provided,
   * they are combined with this config prompt coming first.
   *
   * @example
   * ```typescript
   * // Static prompt
   * {
   *   systemPrompt: 'You are a helpful assistant.'
   * }
   *
   * // Sync function (e.g., reading from cache)
   * {
   *   systemPrompt: () => promptCache.get('my-prompt')
   * }
   *
   * // Async function (e.g., fetching from Langfuse)
   * {
   *   systemPrompt: async () => {
   *     const prompt = await langfuse.getPrompt('my-prompt');
   *     return prompt.compile();
   *   }
   * }
   * ```
   */
  systemPrompt?: string | (() => string | Promise<string>);

  /**
   * Optional filter function for tools.
   * Use this to control which tools are available to this agent.
   * Return true to include the tool, false to exclude it.
   *
   * @example
   * ```typescript
   * // Only allow MCP tools starting with 'db_'
   * {
   *   toolFilter: (tool) =>
   *     !tool._remote || tool.name.startsWith('db_')
   * }
   *
   * // Block dangerous MCP tools
   * {
   *   toolFilter: (tool) =>
   *     !tool._remote ||
   *     (!tool.name.includes('delete') && !tool.name.includes('drop'))
   * }
   * ```
   */
  toolFilter?: (tool: ToolDefinition) => boolean;

  /**
   * Anthropic-specific: Configure cache breakpoints for prompt caching.
   * Only applies when using Anthropic models (Claude).
   *
   * Prompt caching reduces costs and latency by caching message prefixes.
   * Cache breakpoints mark where the cacheable prefix ends.
   *
   * The function receives each message with positional context and returns
   * true to add a cache breakpoint after that message.
   *
   * System prompt is included as role: 'system' at index 0 when present.
   *
   * @see https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
   *
   * @example
   * ```typescript
   * // Cache system prompt + last message (most common pattern)
   * {
   *   cacheBreakpoint: (msg) => msg.role === 'system' || msg.isLast
   * }
   *
   * // Cache only the last message
   * {
   *   cacheBreakpoint: (msg) => msg.isLast
   * }
   *
   * // Cache system prompt only
   * {
   *   cacheBreakpoint: (msg) => msg.role === 'system'
   * }
   *
   * // Cache first 3 messages + last
   * {
   *   cacheBreakpoint: (msg) => msg.index < 3 || msg.isLast
   * }
   *
   * // System prompt with 1h TTL, last message with 5m TTL
   * {
   *   cacheBreakpoint: (msg) => {
   *     if (msg.role === 'system') return '1h';
   *     if (msg.isLast) return '5m';
   *     return false;
   *   }
   * }
   * ```
   */
  cacheBreakpoint?: CacheBreakpointFn;

  /**
   * Maximum number of tokens the model can output per response.
   * @default 4096
   */
  maxOutputTokens?: number;

  /**
   * Temperature for model responses.
   * Lower values (e.g., 0) make responses more deterministic.
   * Higher values (e.g., 1) make responses more creative/random.
   * Useful for testing where deterministic behavior is desired.
   * @default undefined (uses model's default)
   */
  temperature?: number;

  /**
   * Maximum number of model step iterations per run.
   * Each iteration performs one model invocation and may include tool calls.
   * @default 10
   */
  maxSteps?: number;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_MAX_STEPS = 10;

/**
 * Agent implementation for AI SDK models (Anthropic, OpenAI, Google, etc.).
 *
 * This agent is provider-agnostic and works with any AI SDK LanguageModel:
 * - Anthropic Claude (via @ai-sdk/anthropic)
 * - OpenAI GPT (via @ai-sdk/openai)
 * - Google Gemini (via @ai-sdk/google)
 * - And more...
 *
 * Features:
 * - API calls via Vercel AI SDK
 * - Tool coordination with promise-based waiting
 * - Multi-turn conversation history
 * - AG-UI event emission
 * - Optional Langfuse telemetry
 *
 * Used for conversational chat (via useAI hook).
 *
 * @example
 * ```typescript
 * import { createAnthropic } from '@ai-sdk/anthropic';
 * import { openai } from '@ai-sdk/openai';
 *
 * // With Claude
 * const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 * const claudeAgent = new AISDKAgent({
 *   model: anthropic('claude-3-5-sonnet-20241022'),
 * });
 *
 * // With GPT-4
 * const gptAgent = new AISDKAgent({
 *   model: openai('gpt-4-turbo'),
 * });
 *
 * // Agent names come from agents object keys, not from agent config
 * const server = new UseAIServer({
 *   agents: {
 *     claude: claudeAgent,
 *     'gpt-4': gptAgent,
 *   },
 *   defaultAgent: 'claude', // Default agent name
 * });
 * ```
 */
export class AISDKAgent implements Agent {
  private model: LanguageModel;
  private name: string;
  private annotation?: string;
  private toolFilter?: (tool: ToolDefinition) => boolean;
  private systemPrompt?: string | (() => string | Promise<string>);
  private cacheBreakpoint?: CacheBreakpointFn;
  private maxOutputTokens: number;
  private temperature?: number;
  private maxSteps: number;

  constructor(config: AISDKAgentConfig) {
    this.model = config.model;
    this.name = config.name || 'ai-sdk';
    this.annotation = config.annotation;
    this.toolFilter = config.toolFilter;
    this.systemPrompt = config.systemPrompt;
    this.cacheBreakpoint = config.cacheBreakpoint;
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.temperature = config.temperature;
    this.maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
  }

  getName(): string {
    return this.name;
  }

  getAnnotation(): string | undefined {
    return this.annotation;
  }

  /**
   * Flushes pending telemetry data (all registered span processors).
   * Useful for tests to ensure data is sent before querying.
   */
  async flushTelemetry(): Promise<void> {
    await flushAllTelemetry();
  }

  async run(input: AgentInput, events: EventEmitter): Promise<AgentResult> {
    const { session, runId, messages, tools, state, systemPrompt: runtimeSystemPrompt, originalInput } = input;

    // Sync session.tools with input.tools if not already set
    // This ensures tools are available for step-by-step execution
    // (In production, server sets session.tools before calling run; in tests, input.tools may differ)
    if (session.tools.length === 0 && tools.length > 0) {
      session.tools = tools;
    }

    // Resolve config system prompt (may be async, e.g., fetched from Langfuse)
    const configSystemPrompt = await this.resolveSystemPrompt();

    // Build static system messages (config + instructions) — constant across steps for caching
    const staticSystemMessages = this.buildStaticSystemMessages(configSystemPrompt, runtimeSystemPrompt);

    // Emit RUN_STARTED event
    events.emit<RunStartedEvent>({
      type: EventType.RUN_STARTED,
      threadId: session.threadId,
      runId,
      input: originalInput,
      timestamp: Date.now(),
    });

    // Emit MESSAGES_SNAPSHOT event
    // Use messages from original input (AG-UI format) instead of session
    events.emit<MessagesSnapshotEvent>({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: originalInput.messages,
      timestamp: Date.now(),
    });

    // Emit STATE_SNAPSHOT event
    events.emit<StateSnapshotEvent>({
      type: EventType.STATE_SNAPSHOT,
      snapshot: state,
      timestamp: Date.now(),
    });

    let streamTextStarted = false;

    // Create telemetry span to group all step iterations under one OTEL trace.
    const span = startRunSpan({ runId, sessionId: session.clientId });

    // Set span input from last user message (shown in Langfuse list view)
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMessage) {
      span.setInput(lastUserMessage.content);
    }

    try {
      logger.info('Sending to AI SDK model (streaming)', {
        clientId: session.clientId,
        messageCount: messages.length,
        toolCount: tools.length,
      });

      // Sanitize messages before sending to ensure no provider-specific fields leak through (e.g. for Anthropic: 'tool_use_id')
      const sanitizedInputMessages = this.sanitizeMessages(messages);

      // Start with just the user messages - system messages will be prepended in the loop
      // (rebuilt with current state for each step)
      let currentMessages: ModelMessage[] = [...sanitizedInputMessages];

      logger.apiRequest({
        tools: tools.map((t) => t.name),
        messageCount: messages.length,
        messages: messages.map((msg: ModelMessage) => ({
          role: msg.role,
          preview:
            typeof msg.content === 'string'
              ? msg.content.substring(0, 80) + (msg.content.length > 80 ? '...' : '')
              : Array.isArray(msg.content)
              ? `${msg.content.length} content blocks`
              : 'complex content',
        })),
        systemMessages: staticSystemMessages?.map(m => m.content.substring(0, 80) + (m.content.length > 80 ? '...' : '')),
      });

      // Track streaming state across all steps
      let messageId: string | null = null;
      let hasEmittedTextStart = false;
      let finalText = '';
      let currentStepNumber = 0;
      let hasAnyContent = false;

      // Step-by-step execution loop
      // This allows tools and state to be refreshed between steps (e.g., after navigation)
      // Each step runs ONE model invocation, then we check for updated tools/state
      let response: Awaited<ReturnType<typeof streamText>['response']> | null = null;
      // Accumulate response messages from ALL steps for conversation history.
      // response.messages only contains the last step's messages, so without this,
      // mid-step assistant messages and tool calls would be lost in multi-step runs.
      const allResponseMessages: ModelMessage[] = [];
      let lastStepHadToolCalls = false;

      for (let stepIteration = 0; stepIteration <= this.maxSteps; stepIteration++) {
        const isGracefulSummaryStep = stepIteration === this.maxSteps;
        if (isGracefulSummaryStep && !lastStepHadToolCalls) break;

        // Get current tools from session (may have been updated by tool_result handler)
        const currentTools = session.tools;

        // Build dynamic state message from current session state (refreshed each step)
        const stateMessage = this.buildStateMessage(session.state);

        // Assemble messages: static system messages + dynamic state + conversation
        const messagesForStep: ModelMessage[] = [
          ...(staticSystemMessages || []),
          ...(stateMessage ? [stateMessage] : []),
          ...currentMessages,
        ];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const stepConfig = {
          messages: messagesForStep,
          tools: currentTools.length > 0
            ? (this.sanitizeToolsForAPI(this.filterTools(currentTools), session, events) as any)
            : undefined,
          metadata: {
            sessionId: session.clientId,
            threadId: session.threadId,
            runId,
            ipAddress: session.ipAddress,
            toolCount: currentTools.length,
            stepIteration,
            ...((originalInput.forwardedProps as UseAIForwardedProps | undefined)?.telemetryMetadata || {}),
          } as Record<string, AttributeValue>,
        };

        this.applyGracefulSummaryOverrides(isGracefulSummaryStep, stepConfig);

        logger.debug('Starting step iteration', { stepIteration, ...stepConfig.metadata });

        // Apply cache breakpoints for Anthropic prompt caching
        const messagesWithCache = applyCacheBreakpoints(
          stepConfig.messages,
          this.cacheBreakpoint,
          this.model
        );

        streamTextStarted = true;
        const createStream = () => streamText({
          model: this.model,
          messages: messagesWithCache,
          tools: stepConfig.tools,
          // Run ONE step at a time to allow tool refresh between steps
          stopWhen: stepCountIs(1),
          maxOutputTokens: this.maxOutputTokens,
          temperature: this.temperature,
          abortSignal: session.abortController?.signal,
          experimental_telemetry: span.active
            ? { isEnabled: true, functionId: 'use-ai', metadata: stepConfig.metadata }
            : undefined,
          onStepFinish: ({ usage, finishReason }) => {
            logger.debug('Step finished', { usage, finishReason, stepIteration });
          },
        });
        // Call streamText within parent OTEL context so AI SDK spans become children
        const stream = span.wrap(createStream);

        // Track active tool calls for streaming args (per-step)
        const activeToolCalls = new Map<string, { name: string; args: string }>();
        let stepHadToolCalls = false;

        // Process the stream for this step
        for await (const chunk of stream.fullStream) {
          switch (chunk.type) {
            case 'start-step': {
              // New step beginning (for multi-step tool execution)
              events.emit<StepStartedEvent>({
                type: EventType.STEP_STARTED,
                stepName: `step-${currentStepNumber++}`,
                timestamp: Date.now(),
              });
              break;
            }

            case 'text-delta': {
              hasAnyContent = true;
              // Start text message on first text chunk
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

              // Emit delta (AI SDK v6 uses 'text' property)
              events.emit<TextMessageContentEvent>({
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: messageId!,
                delta: chunk.text,
                timestamp: Date.now(),
              });
              finalText += chunk.text;
              break;
            }

            case 'reasoning-delta': {
              // Extended thinking (Claude) - log for now, future AG-UI support
              logger.debug('Reasoning', { text: chunk.text });
              break;
            }

            case 'tool-input-start': {
              hasAnyContent = true;
              stepHadToolCalls = true;
              // Find the tool definition to get annotations
              const toolDef = currentTools.find(t => t.name === chunk.toolName);
              const annotations = getToolAnnotations(toolDef);

              // Emit TOOL_CALL_START with use-ai extensions (annotations only if present)
              // AI SDK v6 uses 'id' as the toolCallId
              const toolCallStartEvent: ToolCallStartEvent & ToolCallStartExtensions = {
                type: EventType.TOOL_CALL_START,
                toolCallId: chunk.id,
                toolCallName: chunk.toolName,
                parentMessageId: messageId ?? uuidv4(),
                timestamp: Date.now(),
              };
              if (annotations) {
                toolCallStartEvent.annotations = annotations;
              }
              events.emit(toolCallStartEvent);
              activeToolCalls.set(chunk.id, { name: chunk.toolName, args: '' });
              break;
            }

            case 'tool-input-delta': {
              // Stream tool arguments
              const toolCall = activeToolCalls.get(chunk.id);
              if (toolCall) {
                toolCall.args += chunk.delta;
                events.emit<ToolCallArgsEvent>({
                  type: EventType.TOOL_CALL_ARGS,
                  toolCallId: chunk.id,
                  delta: chunk.delta,
                  timestamp: Date.now(),
                });
              }
              break;
            }

            case 'tool-call': {
              // Tool call complete - emit TOOL_CALL_END
              // AI SDK will call execute() and stream pauses until it returns
              stepHadToolCalls = true;
              const toolCall = activeToolCalls.get(chunk.toolCallId);
              const finalArgs = JSON.stringify(chunk.input);

              // If no args were streamed at all (tool-input-delta was never called),
              // send the complete args as a single delta.
              // This handles cases where AI SDK skips streaming for empty args.
              // Note: We only handle the case where NO streaming happened.
              // If partial streaming occurred, we trust that data and the client
              // will receive valid JSON through the normal streaming path.
              if (toolCall && toolCall.args.length === 0) {
                events.emit<ToolCallArgsEvent>({
                  type: EventType.TOOL_CALL_ARGS,
                  toolCallId: chunk.toolCallId,
                  delta: finalArgs,
                  timestamp: Date.now(),
                });
                toolCall.args = finalArgs;
              }

              events.emit<ToolCallEndEvent>({
                type: EventType.TOOL_CALL_END,
                toolCallId: chunk.toolCallId,
                timestamp: Date.now(),
              });
              break;
            }

            case 'tool-result': {
              // Tool execution completed (by execute function)
              logger.toolResult(chunk.toolName, JSON.stringify(chunk.output));
              break;
            }

            case 'finish-step': {
              // Step completed - has usage info for telemetry
              events.emit<StepFinishedEvent>({
                type: EventType.STEP_FINISHED,
                stepName: `step-${currentStepNumber - 1}`,
                timestamp: Date.now(),
              });
              break;
            }

            case 'error': {
              throw chunk.error;
            }

            // Ignored chunk types:
            // 'start', 'finish' - internal stream lifecycle
            // 'source' - RAG sources (future)
            // 'file' - generated files (future)
            // 'text-start', 'text-end' - we handle text-delta instead
            // 'reasoning-start', 'reasoning-end' - we handle reasoning-delta
            // 'tool-input-end' - we emit TOOL_CALL_END on 'tool-call' instead
            // 'tool-error', 'tool-output-denied' - error cases
            // 'tool-approval-request' - handled in execute wrapper via createApprovalWrapper
            // 'abort' - handled after loop
            // 'raw' - raw provider data
          }
        }

        // Check if stream was aborted
        if (session.abortController?.signal.aborted) {
          span.endWithError('Run aborted by user');
          events.emit<RunErrorEvent>({
            type: EventType.RUN_ERROR,
            message: 'Run aborted by user',
            timestamp: Date.now(),
          });
          return { success: false, error: 'Run aborted', conversationHistory: messages };
        }

        // Get the response for this step
        response = await stream.response;

        // Collect sanitized messages from this step into the accumulator.
        // This must happen BEFORE the stepHadToolCalls check so that final-step
        // messages (text responses) are also captured.
        const stepMessages = this.sanitizeMessages(response.messages);
        allResponseMessages.push(...stepMessages);

        // Track whether the last completed step had tool calls (for graceful summary)
        lastStepHadToolCalls = stepHadToolCalls;

        // If no tool calls were made in this step, we're done
        if (!stepHadToolCalls) {
          logger.debug('Step had no tool calls, finishing run', { stepIteration });
          break;
        }

        // Tool calls were made - prepare for next iteration
        // Append messages from this step to the conversation for the next model invocation.
        // response.messages only contains generated messages, not input messages,
        // so we must preserve currentMessages to retain the user's original request
        // and any prior step outputs.
        // Note: System messages will be rebuilt with updated state at the start of next iteration
        currentMessages = [
          ...currentMessages,
          ...stepMessages,
        ];

        logger.debug('Continuing to next step after tool calls', {
          stepIteration,
          newMessageCount: currentMessages.length,
          updatedToolCount: session.tools.length,
        });
      }

      // End text message if we started one
      if (hasEmittedTextStart && messageId) {
        events.emit<TextMessageEndEvent>({
          type: EventType.TEXT_MESSAGE_END,
          messageId,
          timestamp: Date.now(),
        });
      }

      // Check for empty response (no text, no tool calls)
      if (!hasAnyContent) {
        span.endWithError('Empty response from AI');
        events.emit<RunErrorEvent>({
          type: EventType.RUN_ERROR,
          message:
            'AI returned an empty response. This may be due to an ambiguous request. Please try being more specific.',
          timestamp: Date.now(),
        });
        return {
          success: false,
          error: 'Empty response from AI',
          conversationHistory: messages,
        };
      }

      // response should be set from the last step
      if (!response) {
        throw new Error('No response from AI SDK');
      }

      // Log final response
      if (finalText) {
        logger.aiResponse([finalText]);
      }

      span.setOutput(finalText);

      // Get trace ID captured by span processor (for Langfuse feedback linking)
      // Must be called before span.end() since end() calls popTraceIdForRun internally
      const traceId = span.popTraceId();

      span.end();

      // Emit RUN_FINISHED with trace ID if available, otherwise original runId
      events.emit<RunFinishedEvent>({
        type: EventType.RUN_FINISHED,
        threadId: session.threadId,
        runId: traceId || runId,
        result: finalText,
        timestamp: Date.now(),
      });

      return {
        success: true,
        conversationHistory: [...messages, ...allResponseMessages],
      };
    } catch (error) {
      // End span and clean up trace ID to prevent memory leak on error paths
      span.endWithError(error instanceof Error ? error.message : String(error));

      logger.error('Error calling AI SDK model', {
        error: error instanceof Error ? error.message : 'Unknown error',
        clientId: session.clientId,
      });

      // Detect error type and send error code for client-side message handling
      let errorCode = ErrorCode.UNKNOWN_ERROR;
      let errorMessage = error instanceof Error ? error.message : 'Unknown error';

      const isAPIError = (err: unknown): err is APIError => {
        return typeof err === 'object' && err !== null;
      };

      if (isAPIError(error)) {
        // Check for API overload (529 status code or overloaded_error type)
        const isOverloaded =
          error.statusCode === 529 ||
          error.data?.error?.type === 'overloaded_error' ||
          (error.message && error.message.toLowerCase().includes('overload'));

        if (isOverloaded) {
          errorCode = ErrorCode.API_OVERLOADED;
        }

        // Check for rate limiting (429 status code)
        const isRateLimited = error.statusCode === 429;
        if (isRateLimited) {
          errorCode = ErrorCode.RATE_LIMITED;
        }
      }

      // Record pre-streamText errors to Langfuse (post-streamText errors are captured by AI SDK OTEL)
      if (!streamTextStarted) {
        const telemetryMetadata = (originalInput.forwardedProps as UseAIForwardedProps | undefined)?.telemetryMetadata;
        span.recordError({
          runId,
          errorCategory: 'pre_stream_error',
          errorMessage,
          sessionId: session.clientId,
          threadId: session.threadId,
          ipAddress: session.ipAddress,
          metadata: { errorCode, toolCount: tools.length, messageCount: messages.length, ...telemetryMetadata },
        });
      }

      events.emit<RunErrorEvent>({
        type: EventType.RUN_ERROR,
        message: errorCode, // Send error code instead of user message
        timestamp: Date.now(),
      });

      return {
        success: false,
        error: errorMessage,
        conversationHistory: messages,
      };
    }
  }

  /**
   * Resolves the systemPrompt configuration value.
   * Handles string, sync function, and async function cases.
   *
   * @returns The resolved system prompt string, or undefined if not configured or empty
   */
  private async resolveSystemPrompt(): Promise<string | undefined> {
    if (!this.systemPrompt) {
      return undefined;
    }

    if (typeof this.systemPrompt === 'string') {
      return this.systemPrompt;
    }

    // It's a function - call it and await the result (works for both sync and async)
    const result = await this.systemPrompt();
    return result || undefined;
  }

  /**
   * Builds an array of static system messages from config and runtime prompts.
   * These are built once per run and remain constant across steps (cacheable prefix).
   *
   * @param configPrompt - Resolved system prompt from agent config (already resolved via resolveSystemPrompt)
   * @param runtimePrompt - System prompt from AgentInput (static instructions from server)
   * @returns Array of SystemModelMessage objects, or undefined if both are empty
   */
  private buildStaticSystemMessages(configPrompt?: string, runtimePrompt?: string): SystemModelMessage[] | undefined {
    const messages: SystemModelMessage[] = [];

    // Config prompt (from backend initialization) comes first
    if (configPrompt) {
      messages.push({ role: 'system', content: configPrompt });
    }

    // Runtime prompt (from server.buildSystemPrompt — static instructions) is added as separate message
    if (runtimePrompt) {
      messages.push({ role: 'system', content: runtimePrompt });
    }

    return messages.length > 0 ? messages : undefined;
  }

  /**
   * Builds a dynamic state system message from the current session state.
   * This is rebuilt each step to reflect state changes from tool executions (e.g., navigation).
   *
   * @param state - Current application state from session
   * @returns A SystemModelMessage with the state, or undefined if no state
   */
  private buildStateMessage(state: unknown): SystemModelMessage | undefined {
    if (!state) return undefined;
    return {
      role: 'system',
      content: `Current application state:\n\n${JSON.stringify(state, null, 2)}`,
    };
  }

  /**
   * When maxSteps is exhausted mid-tool-call chain, overrides step config
   * to strip tools and inject a summary prompt so the model can summarize progress.
   * No-ops when isGracefulSummaryStep is false.
   */
  private applyGracefulSummaryOverrides(
    isGracefulSummaryStep: boolean,
    stepConfig: { messages: ModelMessage[]; tools: unknown; metadata: Record<string, AttributeValue> }
  ): void {
    if (!isGracefulSummaryStep) return;
    stepConfig.messages.push({ role: 'user', content: 'max steps reached, summarize progress' });
    stepConfig.tools = undefined;
    Object.assign(stepConfig.metadata, { toolCount: 0, gracefulSummary: true });
  }

  /**
   * Filters tools using the configured filter function.
   * If no filter is configured, returns all tools.
   */
  private filterTools(tools: ToolDefinition[]): ToolDefinition[] {
    // If no filter configured, return all tools
    if (!this.toolFilter) {
      return tools;
    }

    const originalCount = tools.length;
    const filteredTools = tools.filter(this.toolFilter);
    const filteredCount = originalCount - filteredTools.length;

    if (filteredCount > 0) {
      logger.debug('Filtered tools', {
        agentName: this.name,
        originalCount,
        filteredCount,
        remainingCount: filteredTools.length,
      });
    }

    return filteredTools;
  }

  /**
   * Creates execute function for MCP tools.
   * Note: TOOL_CALL events are emitted from the stream loop, not here.
   * The toolCallId is provided by AI SDK in the execute options.
   */
  private createMcpToolExecutor(
    remoteTool: RemoteToolDefinition,
    session: ClientSession,
    events: EventEmitter
  ): (args: ToolArguments, options: { toolCallId: string }) => Promise<ToolResult> {
    return async (args: ToolArguments, { toolCallId }) => {
      logger.info('[MCP] Executing remote tool', {
        toolName: remoteTool.name,
        toolCallId,
      });

      try {
        const result = await remoteTool._remote.provider.executeTool(
          remoteTool._remote.originalName,
          args,
          session.currentMcpHeaders  // Pass MCP headers from current request
        );

        // Intercept _use_ai_ internal responses from MCP tools
        if (isUseAIInternalResponse(result)) {
          switch (result._use_ai_type) {
            case 'confirmation_required':
              if (isMcpConfirmationResponse(result)) {
                return handleMcpConfirmation(
                  result,
                  toolCallId,
                  remoteTool.name,
                  remoteTool._remote.originalName,
                  args as Record<string, unknown>,
                  remoteTool._remote.provider,
                  session,
                  events,
                  session.currentMcpHeaders
                );
              }
              break;
            default:
              logger.warn('[MCP] Unknown _use_ai_type, returning as-is', {
                toolCallId,
                type: result._use_ai_type,
              });
          }
        }

        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error('[MCP] Remote tool execution failed', {
          toolName: remoteTool.name,
          toolCallId,
          error: errorMsg,
        });
        throw error;
      }
    };
  }

  private sanitizeToolsForAPI(
    tools: ToolDefinition[],
    session: ClientSession,
    events: EventEmitter
  ): Record<string, unknown> {
    const toolsObject: Record<string, unknown> = {};
    const clientToolExecutor = createClientToolExecutor(session);

    for (const toolDef of tools) {
      // Ensure parameters has a type field (required by Anthropic API)
      // AI SDK v6 expects 'inputSchema', not 'parameters'
      const rawParams = toolDef.parameters;
      const inputSchema = rawParams && typeof rawParams === 'object'
        ? { ...rawParams, type: ((rawParams as Record<string, unknown>).type || 'object') as 'object' }
        : { type: 'object' as const, properties: {} };

      // Get the base executor based on tool type
      let baseExecutor;
      if (isRemoteTool(toolDef)) {
        baseExecutor = this.createMcpToolExecutor(toolDef, session, events);
      } else if (isServerTool(toolDef)) {
        baseExecutor = createServerToolExecutor(toolDef, session, events);
      } else {
        baseExecutor = clientToolExecutor;
      }

      // Wrap with approval handling if tool needs confirmation
      const execute = toolNeedsApproval(toolDef)
        ? createApprovalWrapper(toolDef, session, events, baseExecutor)
        : baseExecutor;

      toolsObject[toolDef.name] = {
        description: toolDef.description,
        inputSchema: jsonSchema(inputSchema as JSONSchema7),
        execute,
      };
    }

    return toolsObject;
  }

  /**
   * Zod schemas for AI SDK ModelMessage format.
   * These schemas define the exact structure expected by the AI SDK,
   * automatically stripping any provider-specific fields (like 'id', 'tool_use_id').
   * Using .strip() to silently remove unknown fields rather than throwing errors.
   */
  private static readonly toolResultContentSchema = z.object({
    type: z.literal('tool-result'),
    toolCallId: z.string(),
    toolName: z.string(),
    output: z.unknown(),
    isError: z.boolean().optional(),
  }).strip();

  private static readonly toolCallContentSchema = z.object({
    type: z.literal('tool-call'),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
  }).strip();

  private static readonly textContentSchema = z.object({
    type: z.literal('text'),
    text: z.string(),
  }).strip();

  private static readonly imageContentSchema = z.object({
    type: z.literal('image'),
    image: z.string(), // Can be data URL or remote URL
  }).strip();

  private static readonly fileContentSchema = z.object({
    type: z.literal('file'),
    data: z.string(), // Data URL
    mediaType: z.string(),
  }).strip();

  /**
   * Schema for transformed file content.
   * Transforms the input to a text content part with file context.
   * This allows file transformers on the client to send pre-processed file content.
   */
  private static readonly transformedFileContentSchema = z.object({
    type: z.literal('transformed_file'),
    text: z.string(),
    originalFile: z.object({
      name: z.string(),
      mimeType: z.string(),
      size: z.number(),
    }),
  }).transform((val) => ({
    type: 'text' as const,
    text: `[Content of file "${val.originalFile.name}" (${val.originalFile.mimeType})]:\n\n${val.text}`,
  }));

  private static readonly contentPartSchema = z.union([
    AISDKAgent.textContentSchema,
    AISDKAgent.imageContentSchema,
    AISDKAgent.fileContentSchema,
    AISDKAgent.transformedFileContentSchema,
    AISDKAgent.toolCallContentSchema,
    AISDKAgent.toolResultContentSchema,
  ]);

  private static readonly messageSchema = z.object({
    role: z.enum(['user', 'assistant', 'tool', 'system']),
    content: z.union([
      z.string(),
      z.array(AISDKAgent.contentPartSchema),
    ]),
  }).strip();

  private static readonly messagesArraySchema = z.array(AISDKAgent.messageSchema);

  /**
   * Sanitizes messages from AI SDK responses by removing provider-specific fields.
   * This prevents validation errors when messages are re-sent to the API in subsequent requests.
   *
   * Issue: AI SDK responses may include provider-specific fields (e.g., Anthropic's `id`, `tool_use_id`)
   * that are not valid when sent back to the API. These fields must be stripped.
   *
   * Uses Zod schema parsing with .strict() to automatically strip any extra fields.
   */
  private sanitizeMessages(messages: ModelMessage[]): ModelMessage[] {
    try {
      // Zod parse will automatically strip fields not in the schema (due to .strict())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return AISDKAgent.messagesArraySchema.parse(messages) as any;
    } catch (error) {
      // If parsing fails, log the error and return messages as-is
      // This is a defensive measure to avoid breaking the conversation flow
      logger.error('Failed to sanitize messages with Zod', {
        error: error instanceof Error ? error.message : String(error),
        messageCount: messages.length,
      });
      return messages;
    }
  }

}
