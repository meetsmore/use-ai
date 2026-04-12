import { streamText, jsonSchema, LanguageModel, stepCountIs, type ModelMessage, type SystemModelMessage, type AssistantModelMessage, type ToolModelMessage, type JSONValue } from 'ai';
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
  ToolCallResultEvent,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  StateSnapshotEvent,
  MessagesSnapshotEvent,
  StepStartedEvent,
  StepFinishedEvent,
  ToolCallStartExtensions,
  ReasoningStartEvent,
  ReasoningMessageStartEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningEndEvent,
  ReasoningEncryptedValueEvent,
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
 * Classifies an API error into a specific error code.
 */
function classifyApiError(error: unknown): { errorCode: ErrorCode; errorMessage: string } {
  let errorCode = ErrorCode.UNKNOWN_ERROR;
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';

  const isAPIError = (err: unknown): err is APIError =>
    typeof err === 'object' && err !== null;

  if (isAPIError(error)) {
    const isOverloaded =
      error.statusCode === 529 ||
      error.data?.error?.type === 'overloaded_error' ||
      (error.message && error.message.toLowerCase().includes('overload'));

    if (isOverloaded) {
      errorCode = ErrorCode.API_OVERLOADED;
    }

    if (error.statusCode === 429) {
      errorCode = ErrorCode.RATE_LIMITED;
    }
  }

  return { errorCode, errorMessage };
}

/**
 * Sentinel error thrown when a run is aborted by the user.
 * Caught by handleRunError to return a clean abort result.
 */
class AbortError extends Error {
  constructor() {
    super('Run aborted by user');
    this.name = 'AbortError';
  }
}

/**
 * Mutable state for a single run() invocation.
 * All fields are local to one call — no cross-request sharing.
 */
interface RunContext {
  // From input (read-only after creation)
  readonly session: ClientSession;
  readonly runId: string;
  /** Original unsanitized messages from input, used for conversationHistory returns */
  readonly messages: ModelMessage[];
  readonly tools: ToolDefinition[];
  readonly state: unknown;
  readonly originalInput: AgentInput['originalInput'];
  readonly staticSystemMessages: SystemModelMessage[] | undefined;

  // Streaming state (mutated during run)
  streamTextStarted: boolean;
  finalText: string;
  currentStepNumber: number;
  hasAnyContent: boolean;
  /** Sanitized messages for API calls, rebuilt each step with tool-call results appended */
  currentMessages: ModelMessage[];
  allResponseMessages: ModelMessage[];
  response: Awaited<ReturnType<typeof streamText>['response']> | null;
  /** Whether the last completed step had tool calls (for graceful summary) */
  lastStepHadToolCalls: boolean;
}

/**
 * Mutable state scoped to a single step iteration within executeStepLoop.
 * Reset at the start of each step — never carried across steps.
 */
interface StepContext {
  readonly currentTools: ToolDefinition[];
  readonly activeToolCalls: Map<string, { name: string; args: string }>;
  readonly completedToolCalls: Set<string>;
  stepHadToolCalls: boolean;
  /** Per-step text message ID — set on TEXT_MESSAGE_START, cleared on TEXT_MESSAGE_END */
  messageId: string | null;
  /** Whether TEXT_MESSAGE_START has been emitted in this step */
  hasEmittedTextStart: boolean;
  /** Whether REASONING_START has been emitted in this step */
  hasEmittedReasoningStart: boolean;
  /** Lifecycle ID for REASONING_START / REASONING_END pair */
  reasoningLifecycleId: string | null;
  /** Message ID for REASONING_MESSAGE_START / REASONING_MESSAGE_END pair */
  reasoningMessageId: string | null;
  /**
   * Extracted reasoning signature from provider metadata for multi-turn context.
   * Contains only the signature field for the active provider (e.g., `{ anthropic: { signature: "..." } }`).
   * @see REASONING_SIGNATURE_KEYS for supported providers.
   */
  currentReasoningSignature: Record<string, Record<string, unknown>> | null;
  stepFinishReason: string | undefined;
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
   * Provider-specific options passed directly to `streamText`.
   * Can be used for AI Gateway features like model fallbacks, provider routing, etc.
   *
   * @example
   * ```typescript
   * // Model fallbacks via AI Gateway
   * {
   *   providerOptions: {
   *     gateway: {
   *       models: ['anthropic/claude-opus-4.6', 'google/gemini-3.1-pro-preview'],
   *     },
   *   },
   * }
   *
   * // Model fallbacks + provider routing
   * {
   *   providerOptions: {
   *     gateway: {
   *       models: ['openai/gpt-5-nano', 'anthropic/claude-opus-4.6'],
   *       order: ['azure', 'openai'],
   *     },
   *   },
   * }
   * ```
   */
  providerOptions?: Record<string, Record<string, JSONValue>>;

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
 * Maps provider names to their reasoning signature key in providerMetadata.
 * Used to extract only the encryption/signature data from reasoning chunks,
 * avoiding leaking non-signature metadata (e.g., itemId) through AG-UI events.
 *
 * Currently only Anthropic is tested and supported.
 * To add a new provider, add an entry here with the provider's signature key name:
 *   - OpenAI: 'reasoningEncryptedContent' (untested)
 *   - Google: 'thoughtSignature' (untested)
 */
const REASONING_SIGNATURE_KEYS: Record<string, string> = {
  anthropic: 'signature',
  // openai: 'reasoningEncryptedContent',   // TODO: uncomment when tested
  // google: 'thoughtSignature',            // TODO: uncomment when tested
};

/**
 * Extracts the reasoning signature from providerMetadata for a known provider.
 * Returns only the signature field (not other metadata like itemId) wrapped
 * in the provider namespace, e.g., `{ anthropic: { signature: "..." } }`.
 *
 * Returns null if no known provider signature is found.
 */
function extractReasoningSignature(
  providerMetadata: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> | null {
  if (!providerMetadata) return null;
  for (const [provider, meta] of Object.entries(providerMetadata)) {
    const key = REASONING_SIGNATURE_KEYS[provider];
    if (key && meta[key] != null) {
      return { [provider]: { [key]: meta[key] } };
    }
  }
  return null;
}

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
 * **Reasoning / Extended Thinking:**
 * Reasoning (extended thinking) is currently only tested with Anthropic models.
 * The signature extraction logic supports pluggable providers via {@link REASONING_SIGNATURE_KEYS},
 * but only Anthropic has been verified end-to-end.
 * OpenAI and Google providers are mapped but commented out pending testing.
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
  private providerOptions?: Record<string, Record<string, JSONValue>>;
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
    this.providerOptions = config.providerOptions;
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
    const ctx = await this.createRunContext(input);

    this.emitRunStartEvents(ctx, events);

    const span = this.startTelemetrySpan(ctx);

    try {
      this.logRunStart(ctx);
      await this.executeStepLoop(ctx, events, span);
      return this.finalizeRun(ctx, events, span);
    } catch (error) {
      return this.handleRunError(error, ctx, events, span);
    }
  }

  /**
   * Creates the RunContext for a single run() invocation.
   * Resolves system prompt and initializes all mutable state.
   */
  private async createRunContext(input: AgentInput): Promise<RunContext> {
    const { session, runId, messages, tools, state, systemPrompt: runtimeSystemPrompt, originalInput } = input;

    // Sync session.tools with input.tools if not already set
    // This ensures tools are available for step-by-step execution
    // (In production, server sets session.tools before calling run; in tests, input.tools may differ)
    if (session.tools.length === 0 && tools.length > 0) {
      session.tools = tools;
    }

    // Resolve config system prompt (may be async, e.g., fetched from Langfuse)
    const configSystemPrompt = await this.resolveSystemPrompt();
    const staticSystemMessages = this.buildStaticSystemMessages(configSystemPrompt, runtimeSystemPrompt);

    // Sanitize messages before sending to ensure no provider-specific fields leak through
    const sanitizedInputMessages = this.sanitizeMessages(messages);

    return {
      session,
      runId,
      messages,
      tools,
      state,
      originalInput,
      staticSystemMessages,

      streamTextStarted: false,
      finalText: '',
      currentStepNumber: 0,
      hasAnyContent: false,
      currentMessages: [...sanitizedInputMessages],
      allResponseMessages: [],
      response: null,
      lastStepHadToolCalls: false,
    };
  }

  /**
   * Emits initial lifecycle events: RUN_STARTED, MESSAGES_SNAPSHOT, STATE_SNAPSHOT.
   */
  private emitRunStartEvents(ctx: RunContext, events: EventEmitter): void {
    events.emit<RunStartedEvent>({
      type: EventType.RUN_STARTED,
      threadId: ctx.session.threadId,
      runId: ctx.runId,
      input: ctx.originalInput,
      timestamp: Date.now(),
    });

    events.emit<MessagesSnapshotEvent>({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: ctx.originalInput.messages,
      timestamp: Date.now(),
    });

    events.emit<StateSnapshotEvent>({
      type: EventType.STATE_SNAPSHOT,
      snapshot: ctx.state,
      timestamp: Date.now(),
    });
  }

  /**
   * Creates a telemetry span and sets input from the last user message.
   */
  private startTelemetrySpan(ctx: RunContext): ReturnType<typeof startRunSpan> {
    const span = startRunSpan({ runId: ctx.runId, sessionId: ctx.session.clientId });

    const lastUserMessage = [...ctx.messages].reverse().find(m => m.role === 'user');
    if (lastUserMessage) {
      span.setInput(lastUserMessage.content);
    }

    return span;
  }

  /**
   * Logs the start of a run with message/tool counts and previews.
   */
  private logRunStart(ctx: RunContext): void {
    logger.info('Sending to AI SDK model (streaming)', {
      clientId: ctx.session.clientId,
      messageCount: ctx.messages.length,
      toolCount: ctx.tools.length,
    });

    logger.apiRequest({
      tools: ctx.tools.map((t) => t.name),
      messageCount: ctx.messages.length,
      messages: ctx.messages.map((msg: ModelMessage) => ({
        role: msg.role,
        preview:
          typeof msg.content === 'string'
            ? msg.content.substring(0, 80) + (msg.content.length > 80 ? '...' : '')
            : Array.isArray(msg.content)
            ? `${msg.content.length} content blocks`
            : 'complex content',
      })),
      systemMessages: ctx.staticSystemMessages?.map(m => m.content.substring(0, 80) + (m.content.length > 80 ? '...' : '')),
    });
  }

  /**
   * Runs step-by-step model invocations, refreshing tools/state between steps.
   * Each step runs ONE model invocation, then checks for updated tools/state.
   */
  private async executeStepLoop(
    ctx: RunContext,
    events: EventEmitter,
    span: ReturnType<typeof startRunSpan>,
  ): Promise<void> {
    for (let stepIteration = 0; stepIteration <= this.maxSteps; stepIteration++) {
      const isGracefulSummaryStep = stepIteration === this.maxSteps;
      if (isGracefulSummaryStep && !ctx.lastStepHadToolCalls) break;

      const stepCtx: StepContext = {
        currentTools: ctx.session.tools,
        activeToolCalls: new Map(),
        completedToolCalls: new Set(),
        stepHadToolCalls: false,
        messageId: null,
        hasEmittedTextStart: false,
        hasEmittedReasoningStart: false,
        reasoningLifecycleId: null,
        reasoningMessageId: null,
        currentReasoningSignature: null,
        stepFinishReason: undefined,
      };

      // Build dynamic state message from current session state (refreshed each step)
      const stateMessage = this.buildStateMessage(ctx.session.state);

      // Assemble messages: static system messages + dynamic state + conversation
      const messagesForStep: ModelMessage[] = [
        ...(ctx.staticSystemMessages || []),
        ...(stateMessage ? [stateMessage] : []),
        ...ctx.currentMessages,
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stepConfig = {
        messages: messagesForStep,
        tools: stepCtx.currentTools.length > 0
          ? (this.sanitizeToolsForAPI(this.filterTools(stepCtx.currentTools), ctx.session, events) as any)
          : undefined,
        metadata: {
          sessionId: ctx.session.clientId,
          threadId: ctx.session.threadId,
          runId: ctx.runId,
          ipAddress: ctx.session.ipAddress,
          toolCount: stepCtx.currentTools.length,
          stepIteration,
          ...((ctx.originalInput.forwardedProps as UseAIForwardedProps | undefined)?.telemetryMetadata || {}),
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

      ctx.streamTextStarted = true;
      const createStream = () => streamText({
        model: this.model,
        messages: messagesWithCache,
        tools: stepConfig.tools,
        // Run ONE step at a time to allow tool refresh between steps
        stopWhen: stepCountIs(1),
        maxOutputTokens: this.maxOutputTokens,
        temperature: this.temperature,
        abortSignal: ctx.session.abortController?.signal,
        providerOptions: this.providerOptions,
        experimental_telemetry: span.active
          ? { isEnabled: true, functionId: 'use-ai', metadata: stepConfig.metadata }
          : undefined,
        onStepFinish: ({ usage, finishReason }) => {
          logger.debug('Step finished', { usage, finishReason, stepIteration });
        },
      });
      // Call streamText within parent OTEL context so AI SDK spans become children
      const stream = span.wrap(createStream);

      // Process the stream for this step
      for await (const chunk of stream.fullStream) {
        this.processStreamChunk(chunk, ctx, stepCtx, events);
      }

      // Check if stream was aborted
      if (ctx.session.abortController?.signal.aborted) {
        span.endWithError('Run aborted by user');
        events.emit<RunErrorEvent>({
          type: EventType.RUN_ERROR,
          message: 'Run aborted by user',
          timestamp: Date.now(),
        });
        throw new AbortError();
      }

      // Get the response for this step
      const response = await stream.response;
      ctx.response = response;

      // Collect sanitized messages from this step into the accumulator.
      const stepMessages = this.sanitizeMessages(response.messages);
      ctx.allResponseMessages.push(...stepMessages);
      ctx.currentMessages = [...ctx.currentMessages, ...stepMessages];

      if (this.handleIncompleteToolCalls(ctx, stepCtx)) {
        continue;
      }

      // Track whether the last completed step had tool calls (for graceful summary)
      ctx.lastStepHadToolCalls = stepCtx.stepHadToolCalls;

      // If no tool calls were made in this step, we're done
      if (!stepCtx.stepHadToolCalls) {
        logger.debug('Step had no tool calls, finishing run', { stepIteration });
        break;
      }

      logger.debug('Continuing to next step after tool calls', {
        stepIteration,
        newMessageCount: ctx.currentMessages.length,
        updatedToolCount: ctx.session.tools.length,
      });
    }
  }

  /**
   * Detects incomplete tool calls caused by maxOutputTokens truncation and injects
   * synthetic error tool_results into ctx so the model can retry with shorter arguments.
   *
   * When the stream is cut mid-tool-input, tool-input-start fires but tool-call never fires.
   *
   * Mutates ctx.allResponseMessages and ctx.currentMessages as a side effect.
   * @returns true if recovery messages were injected (caller should continue to next step)
   */
  // TODO: Also handle maxOutputTokens exhaustion during reasoning.
  // When the stream is truncated mid-reasoning (finishReason: 'length'), REASONING_MESSAGE_END
  // and REASONING_END are never emitted, leaving the client in an incomplete state and losing
  // accumulated reasoning text. We should detect open reasoning events (stepCtx.hasEmittedReasoningStart
  // without a corresponding reasoning-end) and emit closing events + log a warning.
  private handleIncompleteToolCalls(
    ctx: RunContext,
    stepCtx: StepContext,
  ): boolean {
    const incompleteToolCalls = [...stepCtx.activeToolCalls.entries()]
      .filter(([id]) => !stepCtx.completedToolCalls.has(id))
      .map(([id, call]) => ({ id, ...call }));
    const recoveryMessages = buildRecoveryToolResults(
      incompleteToolCalls, stepCtx.stepFinishReason, this.maxOutputTokens,
    );
    if (recoveryMessages.length === 0) {
      return false;
    }
    const sanitized = this.sanitizeMessages(recoveryMessages);
    ctx.allResponseMessages.push(...sanitized);
    ctx.currentMessages = [...ctx.currentMessages, ...sanitized];
    logger.warn('Incomplete tool calls detected (likely maxOutputTokens exceeded)', {
      incompleteCount: incompleteToolCalls.length,
    });
    return true;
  }

  /**
   * Processes a single stream chunk, emitting the appropriate AG-UI events.
   * Mutates stepCtx.stepHadToolCalls when a tool call is detected.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processStreamChunk(
    chunk: any,
    ctx: RunContext,
    stepCtx: StepContext,
    events: EventEmitter,
  ): void {
    switch (chunk.type) {
      case 'start-step': {
        events.emit<StepStartedEvent>({
          type: EventType.STEP_STARTED,
          stepName: `step-${ctx.currentStepNumber++}`,
          timestamp: Date.now(),
        });
        return;
      }

      case 'text-delta': {
        ctx.hasAnyContent = true;
        // Start text message on first text chunk of this step
        if (!stepCtx.hasEmittedTextStart) {
          stepCtx.messageId = uuidv4();
          events.emit<TextMessageStartEvent>({
            type: EventType.TEXT_MESSAGE_START,
            messageId: stepCtx.messageId,
            role: 'assistant',
            timestamp: Date.now(),
          });
          stepCtx.hasEmittedTextStart = true;
        }

        // AI SDK v6 uses 'text' property for deltas
        events.emit<TextMessageContentEvent>({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: stepCtx.messageId!,
          delta: chunk.text,
          timestamp: Date.now(),
        });
        ctx.finalText += chunk.text;
        return;
      }

      case 'reasoning-start': {
        // Emit REASONING_START lifecycle event on first reasoning block per step
        if (!stepCtx.hasEmittedReasoningStart) {
          stepCtx.reasoningLifecycleId = uuidv4();
          events.emit<ReasoningStartEvent>({
            type: EventType.REASONING_START,
            messageId: stepCtx.reasoningLifecycleId,
            timestamp: Date.now(),
          });
          stepCtx.hasEmittedReasoningStart = true;
        }
        // Emit REASONING_MESSAGE_START for this reasoning block
        stepCtx.reasoningMessageId = uuidv4();
        events.emit<ReasoningMessageStartEvent>({
          type: EventType.REASONING_MESSAGE_START,
          messageId: stepCtx.reasoningMessageId,
          role: 'reasoning',
          timestamp: Date.now(),
        });
        stepCtx.currentReasoningSignature = null;
        return;
      }

      case 'reasoning-delta': {
        // Emit reasoning start if reasoning-start wasn't received (defensive)
        if (!stepCtx.hasEmittedReasoningStart) {
          stepCtx.reasoningLifecycleId = uuidv4();
          stepCtx.reasoningMessageId = uuidv4();
          events.emit<ReasoningStartEvent>({
            type: EventType.REASONING_START,
            messageId: stepCtx.reasoningLifecycleId,
            timestamp: Date.now(),
          });
          events.emit<ReasoningMessageStartEvent>({
            type: EventType.REASONING_MESSAGE_START,
            messageId: stepCtx.reasoningMessageId,
            role: 'reasoning',
            timestamp: Date.now(),
          });
          stepCtx.hasEmittedReasoningStart = true;
        }

        // AI SDK's reasoning-delta type doesn't expose providerMetadata,
        // but providers may include the signature on delta chunks.
        // Use a type assertion to defensively capture it if present.
        const deltaSignature = extractReasoningSignature(
          (chunk as { providerMetadata?: Record<string, Record<string, unknown>> }).providerMetadata,
        );
        if (deltaSignature) {
          stepCtx.currentReasoningSignature = deltaSignature;
        }

        if (chunk.text) {
          events.emit<ReasoningMessageContentEvent>({
            type: EventType.REASONING_MESSAGE_CONTENT,
            messageId: stepCtx.reasoningMessageId!,
            delta: chunk.text,
            timestamp: Date.now(),
          });
        }
        return;
      }

      case 'reasoning-end': {
        // Capture final signature from reasoning-end event
        const endSignature = extractReasoningSignature(
          (chunk as { providerMetadata?: Record<string, Record<string, unknown>> }).providerMetadata,
        );
        if (endSignature) {
          stepCtx.currentReasoningSignature = endSignature;
        }

        // End the current reasoning message
        events.emit<ReasoningMessageEndEvent>({
          type: EventType.REASONING_MESSAGE_END,
          messageId: stepCtx.reasoningMessageId!,
          timestamp: Date.now(),
        });

        // Emit encrypted value for provider signature (used for multi-turn context).
        // The encryptedValue is a JSON-serialized provider-namespaced object,
        // e.g., `{ "anthropic": { "signature": "..." } }`.
        if (stepCtx.currentReasoningSignature) {
          events.emit<ReasoningEncryptedValueEvent>({
            type: EventType.REASONING_ENCRYPTED_VALUE,
            subtype: 'message',
            entityId: stepCtx.reasoningMessageId!,
            encryptedValue: JSON.stringify(stepCtx.currentReasoningSignature),
            timestamp: Date.now(),
          });
        }

        // End the reasoning lifecycle
        events.emit<ReasoningEndEvent>({
          type: EventType.REASONING_END,
          messageId: stepCtx.reasoningLifecycleId!,
          timestamp: Date.now(),
        });
        return;
      }

      case 'tool-input-start': {
        ctx.hasAnyContent = true;
        stepCtx.stepHadToolCalls = true;

        // Close text message before tool calls so per-step text+tool association is preserved
        if (stepCtx.messageId) {
          events.emit<TextMessageEndEvent>({
            type: EventType.TEXT_MESSAGE_END,
            messageId: stepCtx.messageId,
            timestamp: Date.now(),
          });
        }

        // Find the tool definition to get annotations
        const toolDef = stepCtx.currentTools.find(t => t.name === chunk.toolName);
        const annotations = getToolAnnotations(toolDef);

        // Emit TOOL_CALL_START with use-ai extensions (annotations only if present)
        // AI SDK v6 uses 'id' as the toolCallId
        const parentId = stepCtx.messageId ?? uuidv4();
        // Clear messageId after capturing it for parentMessageId — text is closed
        stepCtx.messageId = null;

        const toolCallStartEvent: ToolCallStartEvent & ToolCallStartExtensions = {
          type: EventType.TOOL_CALL_START,
          toolCallId: chunk.id,
          toolCallName: chunk.toolName,
          parentMessageId: parentId,
          timestamp: Date.now(),
        };
        if (annotations) {
          toolCallStartEvent.annotations = annotations;
        }
        events.emit(toolCallStartEvent);
        stepCtx.activeToolCalls.set(chunk.id, { name: chunk.toolName, args: '' });
        return;
      }

      case 'tool-input-delta': {
        const toolCall = stepCtx.activeToolCalls.get(chunk.id);
        if (toolCall) {
          toolCall.args += chunk.delta;
          events.emit<ToolCallArgsEvent>({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: chunk.id,
            delta: chunk.delta,
            timestamp: Date.now(),
          });
        }
        return;
      }

      case 'tool-call': {
        // Tool call complete - emit TOOL_CALL_END
        // AI SDK will call execute() and stream pauses until it returns
        stepCtx.stepHadToolCalls = true;
        stepCtx.completedToolCalls.add(chunk.toolCallId);
        const toolCall = stepCtx.activeToolCalls.get(chunk.toolCallId);
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
        return;
      }

      case 'tool-result': {
        // Tool execution completed (by execute function)
        logger.toolResult(chunk.toolName, JSON.stringify(chunk.output));

        // Emit TOOL_CALL_RESULT so the client can store the actual result
        // in conversation history. Without this, server-side tools (MCP, server tools)
        // would have placeholder results, causing hallucinations on subsequent turns.
        events.emit<ToolCallResultEvent>({
          type: EventType.TOOL_CALL_RESULT,
          messageId: uuidv4(),
          toolCallId: chunk.toolCallId,
          content: typeof chunk.output === 'string' ? chunk.output : JSON.stringify(chunk.output),
          role: 'tool',
          timestamp: Date.now(),
        });
        return;
      }

      case 'finish': {
        stepCtx.stepFinishReason = chunk.finishReason;
        return;
      }

      case 'finish-step': {
        // Close text message if still open (steps with text but no tool calls)
        if (stepCtx.messageId) {
          events.emit<TextMessageEndEvent>({
            type: EventType.TEXT_MESSAGE_END,
            messageId: stepCtx.messageId,
            timestamp: Date.now(),
          });
          stepCtx.messageId = null;
        }

        events.emit<StepFinishedEvent>({
          type: EventType.STEP_FINISHED,
          stepName: `step-${ctx.currentStepNumber - 1}`,
          timestamp: Date.now(),
        });
        return;
      }

      case 'tool-error': {
        // Tool execution threw an error. Emit TOOL_CALL_RESULT with the error
        // content so the client can store it in conversation history. Without
        // this, the client saves an incomplete history (missing the tool_result
        // for the failed tool), and after server restart the Anthropic API
        // rejects with: "tool_use ids were found without tool_result blocks"
        const errorContent = chunk.error instanceof Error ? chunk.error.message : String(chunk.error);
        logger.toolResult(chunk.toolName, `ERROR: ${errorContent}`);

        events.emit<ToolCallResultEvent>({
          type: EventType.TOOL_CALL_RESULT,
          messageId: uuidv4(),
          toolCallId: chunk.toolCallId,
          content: JSON.stringify({ error: errorContent }),
          role: 'tool',
          timestamp: Date.now(),
        });
        return;
      }

      case 'error': {
        throw chunk.error;
      }

      // Ignored chunk types:
      // 'start' - internal stream lifecycle
      // 'source' - RAG sources (future)
      // 'file' - generated files (future)
      // 'text-start', 'text-end' - we handle text-delta instead
      // reasoning events are handled above (reasoning-start, reasoning-delta, reasoning-end)
      // 'tool-input-end' - we emit TOOL_CALL_END on 'tool-call' instead
      // 'tool-output-denied' - denied tool output cases
      // 'tool-approval-request' - handled in execute wrapper via createApprovalWrapper
      // 'abort' - handled after loop
      // 'raw' - raw provider data
    }
  }

  /**
   * Finalizes a successful run: emits TEXT_MESSAGE_END, checks for empty response,
   * emits RUN_FINISHED, and returns the AgentResult.
   */
  private finalizeRun(
    ctx: RunContext,
    events: EventEmitter,
    span: ReturnType<typeof startRunSpan>,
  ): AgentResult {
    // TEXT_MESSAGE_END is now emitted per-step (in finish-step and tool-input-start),
    // so no need to emit it here.

    // Check for empty response (no text, no tool calls)
    if (!ctx.hasAnyContent) {
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
        conversationHistory: ctx.messages,
      };
    }

    if (!ctx.response) {
      throw new Error('No response from AI SDK');
    }

    if (ctx.finalText) {
      logger.aiResponse([ctx.finalText]);
    }

    span.setOutput(ctx.finalText);

    // Get trace ID captured by span processor (for Langfuse feedback linking)
    // Must be called before span.end() since end() calls popTraceIdForRun internally
    const traceId = span.popTraceId();
    span.end();

    events.emit<RunFinishedEvent>({
      type: EventType.RUN_FINISHED,
      threadId: ctx.session.threadId,
      runId: traceId || ctx.runId,
      result: ctx.finalText,
      timestamp: Date.now(),
    });

    return {
      success: true,
      conversationHistory: [...ctx.messages, ...ctx.allResponseMessages],
    };
  }

  /**
   * Handles errors during a run: classifies the error, records telemetry,
   * emits RUN_ERROR, and returns the AgentResult.
   */
  private handleRunError(
    error: unknown,
    ctx: RunContext,
    events: EventEmitter,
    span: ReturnType<typeof startRunSpan>,
  ): AgentResult {
    // Handle abort as a non-error early return
    if (error instanceof AbortError) {
      return { success: false, error: 'Run aborted', conversationHistory: ctx.messages };
    }

    span.endWithError(error instanceof Error ? error.message : String(error));

    logger.error('Error calling AI SDK model', {
      error: error instanceof Error ? error.message : 'Unknown error',
      clientId: ctx.session.clientId,
    });

    const { errorCode, errorMessage } = classifyApiError(error);

    // Record pre-streamText errors to Langfuse (post-streamText errors are captured by AI SDK OTEL)
    if (!ctx.streamTextStarted) {
      const telemetryMetadata = (ctx.originalInput.forwardedProps as UseAIForwardedProps | undefined)?.telemetryMetadata;
      span.recordError({
        runId: ctx.runId,
        errorCategory: 'pre_stream_error',
        errorMessage,
        sessionId: ctx.session.clientId,
        threadId: ctx.session.threadId,
        ipAddress: ctx.session.ipAddress,
        metadata: { errorCode, toolCount: ctx.tools.length, messageCount: ctx.messages.length, ...telemetryMetadata },
      });
    }

    events.emit<RunErrorEvent>({
      type: EventType.RUN_ERROR,
      message: errorCode,
      timestamp: Date.now(),
    });

    return {
      success: false,
      error: errorMessage,
      conversationHistory: ctx.messages,
    };
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

  /**
   * Schema for reasoning content parts (extended thinking).
   * Preserves providerMetadata (e.g., Anthropic's signature) for multi-turn context.
   *
   * providerMetadata is stored as an opaque record keyed by provider name.
   * The transform merges it into providerOptions so the AI SDK sends it back
   * to the correct provider API for signature verification.
   *
   * Currently only Anthropic signatures are tested.
   * @see REASONING_SIGNATURE_KEYS for the mapping of supported providers.
   */
  private static readonly reasoningContentSchema = z.object({
    type: z.literal('reasoning'),
    text: z.string(),
    providerMetadata: z.record(z.record(z.unknown())).optional(),
    providerOptions: z.record(z.unknown()).optional(),
  }).transform(({ type, text, providerMetadata, providerOptions }) => ({
    type,
    text,
    providerOptions: providerMetadata
      ? { ...providerOptions, ...providerMetadata }
      : providerOptions,
  }));

  private static readonly contentPartSchema = z.union([
    AISDKAgent.textContentSchema,
    AISDKAgent.imageContentSchema,
    AISDKAgent.fileContentSchema,
    AISDKAgent.transformedFileContentSchema,
    AISDKAgent.toolCallContentSchema,
    AISDKAgent.toolResultContentSchema,
    AISDKAgent.reasoningContentSchema,
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

interface IncompleteToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * Builds recovery messages for tool calls truncated by the output token limit.
 *
 * When maxOutputTokens is exceeded mid-stream, tool-input-start fires but tool-call
 * never fires. This injects synthetic error tool_results so the model can retry
 * with shorter arguments.
 *
 * Returns [assistantMessage, ...toolResultMessages] when recovery is needed,
 * or an empty array otherwise.
 *
 * NOTE: We intentionally do NOT emit TOOL_CALL_END for incomplete calls.
 * The client's TOOL_CALL_END handler parses args as JSON and executes the tool,
 * which would fail on truncated JSON. Client-side cleanup of executingTool is
 * handled instead by the RUN_FINISHED/RUN_ERROR handlers.
 */
function buildRecoveryToolResults(
  incompleteToolCalls: IncompleteToolCall[],
  stepFinishReason: string | undefined,
  maxOutputTokens: number,
): ModelMessage[] {
  // Guard with finishReason === 'length' to avoid false-positive recovery on other stream errors.
  if (incompleteToolCalls.length === 0 || stepFinishReason !== 'length') {
    return [];
  }

  const recoveryAssistantMessage: AssistantModelMessage = {
    role: 'assistant',
    content: incompleteToolCalls.map((toolCall) => ({
      type: 'tool-call' as const,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: {},
    })),
  };

  const recoveryToolResults: ToolModelMessage[] = incompleteToolCalls.map((toolCall) => ({
    role: 'tool' as const,
    content: [
      {
        type: 'tool-result' as const,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        output: {
          type: 'text' as const,
          value: `Error: Tool call "${toolCall.name}" failed because its arguments were cut off mid-stream by the output token limit (maxOutputTokens: ${maxOutputTokens}). This call was recorded with args={} as a placeholder — retry with shorter arguments. Truncated args (first 200 chars): ${toolCall.args.substring(0, 200)}`,
        },
      },
    ],
  }));

  return [recoveryAssistantMessage, ...recoveryToolResults];
}
