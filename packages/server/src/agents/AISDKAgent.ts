import { streamText, jsonSchema, LanguageModel, stepCountIs, type ModelMessage, type SystemModelMessage } from 'ai';
import type { JSONSchema7 } from 'json-schema';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { Agent, AgentInput, EventEmitter, AgentResult, ClientSession } from './types';
import type { ToolDefinition } from '../types';
import type { RemoteToolDefinition } from '../mcp';
import { EventType, ErrorCode } from '../types';
import { createClientToolExecutor } from '../utils/toolConverter';
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
} from '../types';
import { logger } from '../logger';
import { initializeLangfuse, type LangfuseConfig } from '../instrumentation';

/**
 * Generic tool arguments type - tools receive key-value pairs
 */
type ToolArguments = Record<string, unknown>;

/**
 * Generic tool result type - tools can return any value
 */
type ToolResult = unknown;

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
   * When both this and the runtime systemPrompt (from AgentInput) are provided,
   * they are combined with this config prompt coming first.
   *
   * @example
   * ```typescript
   * {
   *   systemPrompt: 'You are a helpful assistant. Always respond in Japanese.'
   * }
   * ```
   */
  systemPrompt?: string;

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
  private langfuse: LangfuseConfig;
  private toolFilter?: (tool: ToolDefinition) => boolean;
  private systemPrompt?: string;

  constructor(config: AISDKAgentConfig) {
    this.model = config.model;
    this.name = config.name || 'ai-sdk';
    this.annotation = config.annotation;
    this.toolFilter = config.toolFilter;
    this.systemPrompt = config.systemPrompt;
    // Initialize Langfuse observability (automatically reads env vars)
    this.langfuse = initializeLangfuse();
  }

  getName(): string {
    return this.name;
  }

  getAnnotation(): string | undefined {
    return this.annotation;
  }

  /**
   * Flushes pending Langfuse telemetry data.
   * Useful for tests to ensure data is sent before querying.
   */
  async flushTelemetry(): Promise<void> {
    if (this.langfuse.flush) {
      await this.langfuse.flush();
    }
  }

  async run(input: AgentInput, events: EventEmitter): Promise<AgentResult> {
    const { session, runId, messages, tools, state, systemPrompt: runtimeSystemPrompt, originalInput } = input;

    // Build system messages: config prompt (backend) and runtime prompt as separate messages
    const systemMessages = this.buildSystemMessages(runtimeSystemPrompt);

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

    try {
      logger.info('Sending to AI SDK model (streaming)', {
        clientId: session.clientId,
        messageCount: messages.length,
        toolCount: tools.length,
      });

      // Sanitize messages before sending to ensure no provider-specific fields leak through (e.g. for Anthropic: 'tool_use_id')
      const sanitizedInputMessages = this.sanitizeMessages(messages);

      // Prepend system messages to the messages array
      // This allows multiple system messages to be sent as separate messages
      const messagesWithSystem: ModelMessage[] = [
        ...(systemMessages || []),
        ...sanitizedInputMessages,
      ];

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
        systemMessages: systemMessages?.map(m => m.content.substring(0, 80) + (m.content.length > 80 ? '...' : '')),
      });

      const stream = streamText({
        model: this.model,
        messages: messagesWithSystem,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools:
          tools.length > 0
            ? (this.sanitizeToolsForAPI(this.filterTools(tools), session) as any)
            : undefined,
        stopWhen: stepCountIs(10), // Allow AI SDK to handle multi-step tool execution automatically
        maxOutputTokens: 4096,
        abortSignal: session.abortController?.signal,
        experimental_telemetry: this.langfuse?.enabled
          ? {
              isEnabled: true,
              metadata: {
                sessionId: session.clientId,
                threadId: session.threadId,
                runId,
                ipAddress: session.ipAddress,
                toolCount: tools.length,
              },
            }
          : undefined,
        onStepFinish: ({ usage, finishReason }) => {
          logger.debug('Step finished', { usage, finishReason });
        },
      });

      // Track streaming state
      let messageId: string | null = null;
      let hasEmittedTextStart = false;
      let finalText = '';
      let currentStepNumber = 0;
      let hasAnyContent = false;

      // Track active tool calls for streaming args
      const activeToolCalls = new Map<string, { name: string; args: string }>();

      // Process the stream
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
            // Emit TOOL_CALL_START when tool call begins streaming
            // AI SDK v6 uses 'id' as the toolCallId
            events.emit<ToolCallStartEvent>({
              type: EventType.TOOL_CALL_START,
              toolCallId: chunk.id,
              toolCallName: chunk.toolName,
              parentMessageId: messageId ?? uuidv4(),
              timestamp: Date.now(),
            });
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
          // 'tool-approval-request' - approval workflow
          // 'abort' - handled after loop
          // 'raw' - raw provider data
        }
      }

      // Check if stream was aborted
      if (session.abortController?.signal.aborted) {
        events.emit<RunErrorEvent>({
          type: EventType.RUN_ERROR,
          message: 'Run aborted by user',
          timestamp: Date.now(),
        });
        return { success: false, error: 'Run aborted', conversationHistory: session.conversationHistory };
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

      // Get final result for conversation history
      // In AI SDK v6, response is a Promise
      const response = await stream.response;

      // Update conversation history with all messages from AI SDK
      const responseMessages = response.messages;

      // Determine which messages are new by checking if result.response.messages includes
      // the input messages or only the new messages generated by the AI
      const firstResponseMsg = responseMessages[0];
      const lastInputMsg = sanitizedInputMessages[sanitizedInputMessages.length - 1];

      let includesInputMessages = false;
      if (firstResponseMsg && lastInputMsg) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const firstMsg = firstResponseMsg as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lastMsg = lastInputMsg as any;
        includesInputMessages =
          firstMsg.role === 'user' &&
          lastMsg.role === 'user' &&
          typeof firstMsg.content === 'string' &&
          typeof lastMsg.content === 'string' &&
          firstMsg.content === lastMsg.content;
      }

      const newMessages = includesInputMessages
        ? responseMessages.slice(session.conversationHistory.length)
        : responseMessages;

      // Sanitize messages to remove provider-specific fields before storing
      const sanitizedMessages = this.sanitizeMessages(newMessages);
      session.conversationHistory.push(...sanitizedMessages);

      // Log final response
      if (finalText) {
        logger.aiResponse([finalText]);
      }

      // Emit RUN_FINISHED
      events.emit<RunFinishedEvent>({
        type: EventType.RUN_FINISHED,
        threadId: session.threadId,
        runId,
        result: finalText,
        timestamp: Date.now(),
      });

      return {
        success: true,
        conversationHistory: session.conversationHistory,
      };
    } catch (error) {
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
   * Builds an array of system messages from config and runtime prompts.
   * Each prompt becomes a separate SystemModelMessage, preserving their distinct purposes.
   *
   * @param runtimePrompt - System prompt from AgentInput (generated by server based on state)
   * @returns Array of SystemModelMessage objects, or undefined if both are empty
   */
  private buildSystemMessages(runtimePrompt?: string): SystemModelMessage[] | undefined {
    const messages: SystemModelMessage[] = [];

    // Config prompt (from backend initialization) comes first
    if (this.systemPrompt) {
      messages.push({ role: 'system', content: this.systemPrompt });
    }

    // Runtime prompt (from server.buildSystemPrompt) is added as separate message
    if (runtimePrompt) {
      messages.push({ role: 'system', content: runtimePrompt });
    }

    return messages.length > 0 ? messages : undefined;
  }

  /**
   * Type guard to check if a tool is a remote MCP tool.
   */
  private isRemoteTool(tool: ToolDefinition): tool is RemoteToolDefinition {
    return (tool as RemoteToolDefinition)._remote !== undefined;
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
    session: ClientSession
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
    session: ClientSession
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

      toolsObject[toolDef.name] = {
        description: toolDef.description,
        inputSchema: jsonSchema(inputSchema as JSONSchema7),
        execute: this.isRemoteTool(toolDef)
          ? this.createMcpToolExecutor(toolDef, session)
          : clientToolExecutor,
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

  private static readonly contentPartSchema = z.union([
    AISDKAgent.textContentSchema,
    AISDKAgent.imageContentSchema,
    AISDKAgent.fileContentSchema,
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
