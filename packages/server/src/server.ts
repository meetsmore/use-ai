import { Server as SocketIOServer, Socket } from 'socket.io';
import { ModelMessage, ToolModelMessage } from 'ai';
import { createHash } from 'crypto';
import { EventType, type McpHeadersMap, type UseAIForwardedProps, type ResolveAttachments } from '@meetsmore-oss/use-ai-core';
import { resolveAttachmentParts, countRefParts } from './attachmentResolution';
import type {
  UseAIServerConfig,
  McpEndpointConfig,
  ToolDefinition,
  UseAIClientMessage,
  RunAgentMessage,
  RunWorkflowMessage,
  ToolResultMessage,
  AbortRunMessage,
  ToolApprovalResponseMessage,
  Message,
  AGUIEvent,
  CorsOptions,
} from './types';
import { RateLimiter } from './rateLimiter';
import { logger } from './logger';
import { recordErrorTrace, startTracing } from './instrumentation';
import { v4 as uuidv4 } from 'uuid';
import type { Agent, EventEmitter, AGUIEventExtended } from './agents/types';
import type { ClientSession } from './agents/types';
import type { UseAIServerPlugin, MessageHandler } from './plugins/types';
import { FeedbackPlugin } from './plugins/FeedbackPlugin';
import { isRemoteTool, isServerTool } from './utils/toolFilters';
import { abortRun, RunAbortedByUser, RunAbortedByClientDisconnect } from './utils/abortReason';
import { RemoteMcpToolsProvider, type RemoteToolDefinition } from './mcp';
import type { ServerToolDefinition } from './tools/types';
import { findMatch } from './utils/patternMatcher';
import {
  createRuntimeAdapter,
  createClientIpTracker,
  type RuntimeAdapter,
  type RuntimeServerHandle,
  type ClientIpTracker,
} from './runtime';

// Re-export ClientSession type for external use
export type { ClientSession } from './agents/types';

/**
 * WebSocket server that coordinates between client applications and AI agents.
 * Supports pluggable agents (AISDKAgent, etc.) via AG-UI protocol.
 *
 * Responsibilities:
 * - Manages WebSocket connections from clients
 * - Accepts RunAgentInput messages
 * - Delegates to pluggable agents (AISDKAgent, etc.)
 * - Emits AG-UI events (TEXT_MESSAGE_*, TOOL_CALL_*, etc.)
 * - Routes tool execution requests back to clients
 * - Maintains conversation history and state per session
 * - Handles rate limiting
 * - Supports plugins for extending functionality
 *
 * @example
 * ```typescript
 * import { UseAIServer, AISDKAgent } from '@meetsmore-oss/use-ai-server';
 * import { createAnthropic } from '@ai-sdk/anthropic';
 * import { openai } from '@ai-sdk/openai';
 *
 * // Single agent (Claude)
 * const anthropic = createAnthropic({
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 * });
 * const claudeAgent = new AISDKAgent({
 *   hooks: { loadConfig: () => ({ model: anthropic('claude-opus-5') }) },
 * });
 * const server = new UseAIServer({
 *   port: 8081,
 *   agents: { claude: claudeAgent },
 *   defaultAgent: 'claude', // Default agent name
 * });
 *
 * // Multiple agents (Claude + OpenAI)
 * const gptAgent = new AISDKAgent({
 *   hooks: { loadConfig: () => ({ model: openai('gpt-4-turbo') }) },
 * });
 * const multiServer = new UseAIServer({
 *   port: 8081,
 *   agents: {
 *     claude: claudeAgent,
 *     'gpt-4': gptAgent,
 *   },
 *   runner: 'claude', // Default for chat
 * });
 * ```
 */
export class UseAIServer {
  private io: SocketIOServer;
  private runtimeAdapter: RuntimeAdapter;
  private serverHandle: RuntimeServerHandle | null = null;
  private agent: Agent; // Default agent for chat (run_agent)
  private defaultAgentId: string; // ID of the default agent
  private agents: Record<string, Agent>; // Registry of all agents
  private clients: Map<string, ClientSession> = new Map();
  private config: Required<Omit<UseAIServerConfig, 'defaultAgent' | 'agents' | 'plugins' | 'tools' | 'mcpEndpoints' | 'maxHttpBufferSize' | 'cors' | 'idleTimeout' | 'runtime' | 'spanProcessors' | 'resolveAttachments'>> & {
    maxHttpBufferSize: number;
    cors?: CorsOptions;
    idleTimeout: number;
  };
  private rateLimiter: RateLimiter;
  private cleanupInterval: NodeJS.Timeout;
  private clientIdCounter = 0;
  private plugins: UseAIServerPlugin[] = [];
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private mcpEndpoints: RemoteMcpToolsProvider[] = [];
  private serverTools: ServerToolDefinition[] = [];
  // Optional host seam. Resolves attachment refs into model-readable parts at run start.
  private resolveAttachments?: ResolveAttachments;
  // Tracks client IP addresses for both WebSocket and polling transports
  private clientIpTracker: ClientIpTracker;

  /**
   * Creates a new UseAI server instance.
   *
   * @param config - Server configuration options
   * @throws Error if the specified agent name does not exist in the agents map
   */
  constructor(config: UseAIServerConfig) {
    // Start OTel tracing with optional custom span processors.
    // No-op after first call, so safe if multiple UseAIServer instances are created.
    startTracing(config.spanProcessors);

    this.config = {
      port: config.port ?? 8081,
      rateLimitMaxRequests: config.rateLimitMaxRequests ?? 0,
      rateLimitWindowMs: config.rateLimitWindowMs ?? 60000,
      maxHttpBufferSize: config.maxHttpBufferSize ?? 20 * 1024 * 1024, // 20MB default
      cors: config.cors,
      idleTimeout: config.idleTimeout ?? 30,
    };

    // Set agents registry
    this.agents = config.agents;

    // Get the default agent by name
    const defaultAgent = this.agents[config.defaultAgent];
    if (!defaultAgent) {
      throw new Error(
        `Agent "${config.defaultAgent}" not found in agents config. Available agents: ${Object.keys(this.agents).join(', ')}`
      );
    }
    this.agent = defaultAgent;
    this.defaultAgentId = config.defaultAgent;

    this.rateLimiter = new RateLimiter({
      maxRequests: this.config.rateLimitMaxRequests,
      windowMs: this.config.rateLimitWindowMs,
    });

    // Create client IP tracker
    this.clientIpTracker = createClientIpTracker();

    this.cleanupInterval = setInterval(() => {
      this.rateLimiter.cleanup();
    }, this.config.rateLimitWindowMs);

    // Create RemoteMcpToolsProvider instances (to reference remote tools)
    if (config.mcpEndpoints && config.mcpEndpoints.length > 0) {
      this.mcpEndpoints = config.mcpEndpoints.map(endpoint => new RemoteMcpToolsProvider(endpoint));
      logger.info('[MCP] Created remote MCP instances', {
        count: this.mcpEndpoints.length,
        endpoints: this.mcpEndpoints.map(e => e.getUrl()),
      });
    }

    // Convert server tools config to ServerToolDefinition[]
    if (config.tools) {
      this.serverTools = Object.entries(config.tools).map(([name, toolConfig]) => ({
        name,
        description: toolConfig.description,
        parameters: toolConfig.parameters,
        annotations: toolConfig.annotations,
        _server: {
          execute: toolConfig.execute,
        },
      }));
      logger.info('[Server Tools] Registered server tools', {
        count: this.serverTools.length,
        names: this.serverTools.map(t => t.name),
      });
    }

    this.resolveAttachments = config.resolveAttachments;

    // Initialize plugins
    this.plugins = config.plugins ?? [];
    this.initializePlugins();

    // Create runtime adapter based on configuration
    this.runtimeAdapter = createRuntimeAdapter(config.runtime ?? 'auto');
    logger.info('Using runtime adapter', { runtime: this.runtimeAdapter.name });

    // Create Socket.IO server
    this.io = new SocketIOServer({
      transports: ['polling', 'websocket'],
      maxHttpBufferSize: this.config.maxHttpBufferSize,
    });

    this.setupSocketIOServer();

    if (this.rateLimiter.isEnabled()) {
      logger.info('Rate limiting enabled', {
        maxRequests: this.config.rateLimitMaxRequests,
        windowMs: this.config.rateLimitWindowMs,
      });
    }

    // Start server using runtime adapter
    this.serverHandle = this.runtimeAdapter.createServer(this.io, {
      port: this.config.port,
      idleTimeout: this.config.idleTimeout,
      cors: this.config.cors,
      maxHttpBufferSize: this.config.maxHttpBufferSize,
      onPollingConnection: (sessionId, ip) => {
        this.clientIpTracker.trackPollingConnection(sessionId, ip);
      },
    });
  }

  /**
   * Initializes the server by fetching MCP tools from all endpoints.
   * Must be called before the server starts accepting connections.
   */
  async initialize(): Promise<void> {
    // Initialize all MCP endpoints (fetch tools)
    if (this.mcpEndpoints.length > 0) {
      logger.info('[MCP] Initializing MCP endpoints', { count: this.mcpEndpoints.length });

      const results = await Promise.allSettled(
        this.mcpEndpoints.map(endpoint => endpoint.initialize())
      );

      // Log results
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed > 0) {
        logger.warn('[MCP] Some endpoints failed to initialize', { successful, failed });
      } else {
        logger.info('[MCP] All endpoints initialized successfully', { count: successful });
      }
    }
  }

  /**
   * Initialize all plugins by calling their registerHandlers method.
   * This allows plugins to register custom message handlers.
   */
  private initializePlugins() {

    // Auto-enable FeedbackPlugin if Langfuse env vars are set and not already configured
    const hasFeedbackPlugin = this.plugins.some(p => p.getName() === 'feedback');
    if (!hasFeedbackPlugin && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
      this.plugins.push(new FeedbackPlugin());
    }

    for (const plugin of this.plugins) {
      logger.info('Initializing plugin', { pluginName: plugin.getName() });

      plugin.registerHandlers({
        registerMessageHandler: this.registerMessageHandler.bind(this),
      });
    }
  }

  /**
   * Register a custom message handler for a specific message type.
   * Used by plugins to handle custom message types.
   *
   * @param type - The message type to handle (e.g., 'run_workflow')
   * @param handler - The handler function to call when this message type is received
   */
  public registerMessageHandler(type: string, handler: MessageHandler): void {
    if (this.messageHandlers.has(type)) {
      logger.warn('Overwriting existing message handler', { type });
    }

    this.messageHandlers.set(type, handler);
    logger.debug('Registered message handler', { type });
  }

  private setupSocketIOServer() {
    this.io.on('connection', (socket: Socket) => {
      const clientId = `client-${++this.clientIdCounter}`;
      const threadId = uuidv4();
      // Get connection info for IP address resolution
      const conn = socket.conn as unknown as { id: string; transport: { name: string; socket?: { remoteAddress?: string } } };
      // Get IP address for rate limiting:
      // 1. Try clientIpTracker (works for polling transport)
      // 2. Fall back to socket.handshake.address (works for WebSocket)
      // 3. Last resort: use socket.id
      const ipAddress = this.clientIpTracker.getClientIp(conn)
        || socket.handshake.address
        || socket.id;
      const transport = conn.transport.name;
      logger.info('Client connected', { clientId, threadId, ipAddress, transport });

      // Log transport upgrades
      socket.conn.on('upgrade', (transport) => {
        logger.info('Client upgraded transport', { clientId, transport: transport.name });
      });

      const session: ClientSession = {
        clientId,
        ipAddress,
        socket,
        threadId,
        tools: [],
        state: null,
        pendingToolCalls: new Map(),
        pendingToolApprovals: new Map(),
      };

      this.clients.set(socket.id, session);

      // Send available agents to client
      const availableAgents = Object.entries(this.agents).map(([id, agent]) => ({
        id,
        name: agent.getName?.() || id,
        annotation: agent.getAnnotation?.(),
      }));
      socket.emit('agents', {
        agents: availableAgents,
        defaultAgent: this.defaultAgentId,
      });

      // Call plugin lifecycle hooks
      for (const plugin of this.plugins) {
        plugin.onClientConnect?.(session);
      }

      socket.on('message', async (message: UseAIClientMessage) => {
        try {
          await this.handleClientMessage(socket, message);
        } catch (error) {
          logger.error('Error handling message', {
            error: error instanceof Error ? error.message : 'Unknown error',
            clientId,
          });
          if (message.type === 'run_agent') {
            const runAgentData = (message as RunAgentMessage).data;
            const unhandledForwardedProps = runAgentData?.forwardedProps as UseAIForwardedProps | undefined;
            recordErrorTrace({
              runId: runAgentData?.runId || socket.id,
              errorCategory: 'unhandled_error',
              errorMessage: error instanceof Error ? error.message : 'Unknown error',
              sessionId: clientId,
              threadId: runAgentData?.threadId,
              ipAddress: session?.ipAddress,
              metadata: { ...unhandledForwardedProps?.telemetryMetadata },
            });
          }
          this.sendEvent(socket, {
            type: EventType.RUN_ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now(),
          });
        }
      });

      socket.on('disconnect', () => {
        logger.info('Client disconnected', { clientId, ipAddress });

        // Abort any pending tool calls/approvals for this session
        abortRun(session.abortController, new RunAbortedByClientDisconnect());

        // Clean up polling IP entry
        this.clientIpTracker.removePollingConnection(conn.id);

        // Call plugin lifecycle hooks
        for (const plugin of this.plugins) {
          plugin.onClientDisconnect?.(session);
        }

        // Note: Rate limiting persists by IP address across connections
        this.clients.delete(socket.id);
      });
    });

    logger.info('UseAI server ready', { port: this.config.port });
  }

  private async handleClientMessage(socket: Socket, message: UseAIClientMessage) {
    const session = this.clients.get(socket.id);
    if (!session) return;

    // Check if a plugin has registered a handler for this message type
    const pluginHandler = this.messageHandlers.get(message.type);
    if (pluginHandler) {
      await pluginHandler(session, message);
      return;
    }

    // Core message handlers
    switch (message.type) {
      case 'run_agent':
        await this.handleRunAgent(session, message as RunAgentMessage);
        break;
      case 'tool_result':
        this.handleToolResult(session, message as ToolResultMessage);
        break;
      case 'tool_approval_response':
        this.handleToolApprovalResponse(session, message as ToolApprovalResponseMessage);
        break;
      case 'abort_run':
        this.handleAbortRun(session, message as AbortRunMessage);
        break;
      default:
        logger.warn('Unknown message type', { type: message.type });
    }
  }

  private async handleRunAgent(session: ClientSession, message: RunAgentMessage) {
    const { threadId, runId, messages, tools, state, context, forwardedProps: rawForwardedProps } = message.data;

    // Extract use-ai extensions from forwardedProps (AG-UI extension point)
    const forwardedProps = rawForwardedProps as UseAIForwardedProps | undefined;
    const mcpHeaders = forwardedProps?.mcpHeaders;
    const requestedAgent = forwardedProps?.agent;

    // Select agent: use requested agent if valid, otherwise fall back to default
    let selectedAgent = this.agent;
    if (requestedAgent) {
      const agent = this.agents[requestedAgent];
      if (agent) {
        selectedAgent = agent;
        logger.debug('Using requested agent', { agent: requestedAgent });
      } else {
        const availableAgents = Object.keys(this.agents);
        logger.warn('Requested agent not found', {
          requested: requestedAgent,
          available: availableAgents,
        });
        recordErrorTrace({
          runId,
          errorCategory: 'agent_not_found',
          errorMessage: `Agent "${requestedAgent}" not found`,
          sessionId: session.clientId,
          threadId,
          ipAddress: session.ipAddress,
          metadata: { requestedAgent, availableAgents, ...forwardedProps?.telemetryMetadata },
        });
        this.sendEvent(session.socket, {
          type: EventType.RUN_ERROR,
          message: `Agent "${requestedAgent}" not found. Available agents: ${availableAgents.join(', ')}`,
          timestamp: Date.now(),
        });
        return;
      }
    }

    // Rate limiting by IP address
    const rateLimitCheck = this.rateLimiter.checkLimit(session.ipAddress);
    if (!rateLimitCheck.allowed) {
      const retryAfterSeconds = Math.ceil((rateLimitCheck.retryAfterMs || 0) / 1000);
      recordErrorTrace({
        runId,
        errorCategory: 'rate_limit_exceeded',
        errorMessage: 'Rate limit exceeded',
        sessionId: session.clientId,
        threadId,
        ipAddress: session.ipAddress,
        metadata: { retryAfterSeconds, ...forwardedProps?.telemetryMetadata },
      });
      this.sendEvent(session.socket, {
        type: EventType.RUN_ERROR,
        message: `Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds.`,
        timestamp: Date.now(),
      });
      return;
    }

    // Update session
    session.threadId = threadId;
    session.currentRunId = runId;

    // Create AbortController for this run (used to cancel pending tool calls/approvals on disconnect)
    session.abortController = new AbortController();

    // Store MCP headers for this request (will be cleared after run completes)
    session.currentMcpHeaders = mcpHeaders;

    // Merge client tools with MCP tools from all endpoints
    const clientTools = tools.map(t => ({
      ...t,
      parameters: t.parameters || { type: 'object', properties: {}, required: [] },
    })) as ToolDefinition[];

    // Lazy fetch MCP tools (per-session caching with auth headers)
    let mcpTools: RemoteToolDefinition[] = [];
    if (this.mcpEndpoints.length > 0) {
      mcpTools = await this.getMcpToolsForSession(session, mcpHeaders);
    }

    // Merge: client tools + MCP tools + server tools
    session.tools = [...clientTools, ...mcpTools, ...this.serverTools];

    if (mcpTools.length > 0 || this.serverTools.length > 0) {
      logger.debug('Merged tools', {
        clientTools: clientTools.length,
        mcpTools: mcpTools.length,
        serverTools: this.serverTools.length,
        total: session.tools.length,
      });
    }

    session.state = state;

    // Types for AG-UI content blocks
    type TextBlock = { type: 'text'; text: string };
    type ImageBlock = { type: 'image_url'; url: string };
    type FileBlock = { type: 'file_url'; url: string; mimeType: string; name?: string };
    type ContentBlock = TextBlock | ImageBlock | FileBlock | { type: string; [key: string]: unknown };
    type MessageContent = string | ContentBlock[] | Record<string, unknown> | undefined;

    // AI SDK content part types (matching AI SDK v6 UserContent)
    type AISDKTextPart = { type: 'text'; text: string };
    type AISDKImagePart = { type: 'image'; image: string };
    type AISDKFilePart = { type: 'file'; data: string; mediaType: string };
    type AISDKContentPart = AISDKTextPart | AISDKImagePart | AISDKFilePart;

    // Type guard for tool messages with additional properties
    type ToolMessage = Message & {
      role: 'tool';
      tool_call_id?: string;
      toolCallId?: string;
    };

    const isToolMessage = (msg: Message): msg is ToolMessage => {
      return msg.role === 'tool';
    };

    // Helper to extract text content as string (for assistant messages and tool results)
    const getStringContent = (content: MessageContent): string => {
      if (!content) return '';
      if (typeof content === 'string') return content;
      // If it's an array, extract text from text blocks
      if (Array.isArray(content)) {
        return content
          .filter((block): block is TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');
      }
      // If it's an object (Record), convert to JSON string
      if (typeof content === 'object') {
        return JSON.stringify(content);
      }
      return '';
    };

    // Helper to convert AG-UI content to AI SDK content format (preserves multimodal)
    const convertToAISDKContent = (content: MessageContent): string | AISDKContentPart[] => {
      if (!content) return '';
      if (typeof content === 'string') return content;

      // If it's an array, convert each block to AI SDK format
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
            const originalFile = (block as { originalFile?: { name?: string; mimeType?: string } }).originalFile;
            const fileName = originalFile?.name || 'file';
            const mimeType = originalFile?.mimeType || 'application/octet-stream';
            parts.push({
              type: 'text',
              text: `[Content of file "${fileName}" (${mimeType})]:\n\n${block.text as string}`,
            });
          }
        }

        // If only text parts, return as string for simplicity
        if (parts.length === 1 && parts[0].type === 'text') {
          return parts[0].text;
        }

        return parts.length > 0 ? parts : '';
      }

      // If it's an object (Record), convert to JSON string
      if (typeof content === 'object') {
        return JSON.stringify(content);
      }
      return '';
    };

    // Resolve refs once at run start, before AI SDK conversion (not per step; see ResolveAttachments for the contract).
    let resolvedMessages = messages;
    let resolveErrored = false;
    if (this.resolveAttachments) {
      try {
        resolvedMessages = await resolveAttachmentParts(messages, this.resolveAttachments, { forwardedProps });
      } catch (error) {
        // A resolver failure must not bring down the whole run. Degrade and continue unresolved
        // (respond with text only), dropping the attachment; the WARN below records it.
        resolveErrored = true;
        logger.error('resolveAttachments failed; proceeding without resolved attachments', {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
        resolvedMessages = messages;
      }
    }

    // Unresolved ref parts are silently dropped during conversion: the run "succeeds" but the
    // attachment never reaches the model. Record this silent failure.
    const unresolvedRefs = countRefParts(resolvedMessages);
    if (unresolvedRefs > 0) {
      logger.warn('Attachment refs left unresolved; attachments will not reach the model', {
        runId,
        unresolvedRefs,
        reason: resolveErrored
          ? 'resolver-errored'
          : this.resolveAttachments
            ? 'resolver-returned-ref'
            : 'no-resolver-wired',
      });
    }

    // Convert AG-UI messages to AI SDK ModelMessage format
    const incomingMessages: ModelMessage[] = resolvedMessages.map((msg, msgIndex) => {
      if (msg.role === 'user') {
        return {
          role: 'user' as const,
          content: convertToAISDKContent(msg.content),
        };
      } else if (msg.role === 'assistant') {
        const textContent = getStringContent(msg.content);

        // Check for reasoning parts (extended thinking, persisted from previous runs).
        // encryptedValue contains JSON-serialized provider metadata (e.g., Anthropic signature).
        // AISDKAgent.reasoningContentSchema transforms it to providerOptions
        // (the format the AI SDK sends to the Anthropic API for signature verification).
        const reasoningParts = (msg as { reasoningParts?: Array<{
          text: string;
          encryptedValue?: string;
        }> }).reasoningParts;

        // Check for AG-UI toolCalls on the message (sent by client on reconnection)
        const toolCalls = (msg as { toolCalls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
          encryptedValue?: string;
        }> }).toolCalls;

        // Build content blocks when reasoning or tool calls are present
        const hasReasoning = reasoningParts && reasoningParts.length > 0;
        const hasToolCalls = toolCalls && toolCalls.length > 0;

        if (hasReasoning || hasToolCalls) {
          const content: Array<
            | { type: 'text'; text: string }
            | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown; providerMetadata?: Record<string, unknown> }
            | { type: 'reasoning'; text: string; providerMetadata?: Record<string, unknown> }
          > = [];

          // Add reasoning parts first (before text/tool-calls) for multi-turn context
          if (hasReasoning) {
            for (const rp of reasoningParts) {
              // Deserialize encryptedValue back to providerMetadata for AI SDK format
              let providerMetadata: Record<string, unknown> | undefined;
              if (rp.encryptedValue) {
                try {
                  providerMetadata = JSON.parse(rp.encryptedValue);
                } catch {
                  // Ignore malformed encryptedValue
                }
              }
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
              let input: unknown;
              try {
                input = JSON.parse(tc.function.arguments);
              } catch {
                input = tc.function.arguments;
              }
              // Deserialize encryptedValue to providerMetadata (Gemini thoughtSignature)
              let tcProviderMetadata: Record<string, unknown> | undefined;
              if (tc.encryptedValue) {
                try {
                  tcProviderMetadata = JSON.parse(tc.encryptedValue);
                } catch {
                  // Ignore malformed encryptedValue
                }
              }
              content.push({
                type: 'tool-call',
                toolCallId: tc.id,
                toolName: tc.function.name,
                input,
                ...(tcProviderMetadata ? { providerMetadata: tcProviderMetadata } : {}),
              });
            }
          }

          return {
            role: 'assistant' as const,
            content,
          };
        }

        return {
          role: 'assistant' as const,
          content: textContent,
        };
      } else if (isToolMessage(msg)) {
        // Tool messages in AI SDK v6 ModelMessage format.
        // The output field requires a discriminated union: { type: "json"|"text", value }
        const content = getStringContent(msg.content);
        let output: { type: 'json'; value: unknown } | { type: 'text'; value: string };
        try {
          const parsed = JSON.parse(content);
          output = { type: 'json', value: parsed };
        } catch {
          output = { type: 'text', value: content };
        }
        const toolCallId = msg.tool_call_id || msg.toolCallId || uuidv4();

        // AG-UI ToolMessage has no toolName field. Resolve it by scanning back
        // through the preceding assistant messages' toolCalls.
        // Also look up encryptedValue for Gemini thoughtSignature propagation to tool results.
        let toolName: string | undefined;
        let toolEncryptedValue: string | undefined;
        for (let i = msgIndex - 1; i >= 0; i--) {
          const prevToolCalls = (resolvedMessages[i] as { toolCalls?: Array<{
            id: string;
            function: { name: string };
            encryptedValue?: string;
          }> }).toolCalls;
          if (prevToolCalls) {
            const match = prevToolCalls.find(tc => tc.id === toolCallId);
            if (match) {
              toolName = match.function.name;
              toolEncryptedValue = match.encryptedValue;
              break;
            }
          }
        }

        // Deserialize encryptedValue to providerMetadata for tool result
        // (Gemini requires thoughtSignature on both tool-call and tool-result parts)
        let toolResultProviderMetadata: Record<string, unknown> | undefined;
        if (toolEncryptedValue) {
          try {
            toolResultProviderMetadata = JSON.parse(toolEncryptedValue);
          } catch {
            // Ignore malformed encryptedValue
          }
        }

        return {
          role: 'tool' as const,
          content: [
            {
              type: 'tool-result' as const,
              toolCallId,
              toolName: toolName || 'unknown',
              output,
              ...(toolResultProviderMetadata ? { providerMetadata: toolResultProviderMetadata } : {}),
            },
          ],
        } as ToolModelMessage;
      }
      // Default fallback
      return {
        role: 'user' as const,
        content: convertToAISDKContent(msg.content),
      };
    });

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(session, state);

    // Create event emitter that forwards all events to client
    const eventEmitter: EventEmitter = {
      emit: <T extends AGUIEventExtended>(event: T) => {
        this.sendEvent(session.socket, event);
      },
    };

    // Build agent input
    const agentInput = {
      session,
      runId,
      messages: incomingMessages,
      tools: session.tools,
      state,
      systemPrompt,
      originalInput: message.data,
    };

    // Run beforeRunAgent hooks from all plugins
    for (const plugin of this.plugins) {
      if (plugin.beforeRunAgent) {
        const result = await plugin.beforeRunAgent(agentInput);
        if (result?.abort) {
          this.sendEvent(session.socket, {
            type: EventType.RUN_ERROR,
            message: result.message,
            timestamp: Date.now(),
          });
          return;
        }
      }
    }

    // Delegate to selected agent
    try {
      await selectedAgent.run(agentInput, eventEmitter);
    } finally {
      // Clear MCP headers after run completes (success or failure)
      delete session.currentMcpHeaders;
    }
  }

  private buildSystemPrompt(session: ClientSession, state: unknown): string | undefined {
    if (!state) return undefined;
    return 'You are interacting with a web application. Use the available tools to interact with and modify the UI based on user requests.';
  }

  private handleToolResult(session: ClientSession, message: ToolResultMessage) {
    const { toolCallId, content, forwardedProps } = message.data;

    // Extract use-ai extensions from forwardedProps
    const tools = forwardedProps?.tools;
    const state = forwardedProps?.state;

    // Update session tools if client sent updated tools
    // This allows mid-run tool updates (e.g., after navigation to a new page)
    if (tools && tools.length > 0) {
      // Client only knows about client tools, so forwardedProps.tools never includes
      // MCP (remote) tools or server tools. Preserve both when merging.
      const existingRemoteTools = session.tools.filter(isRemoteTool);
      const existingServerTools = session.tools.filter(isServerTool);

      const updatedClientTools = tools.map(t => ({
        ...t,
        parameters: t.parameters || { type: 'object', properties: {}, required: [] },
      })) as ToolDefinition[];

      session.tools = [...updatedClientTools, ...existingRemoteTools, ...existingServerTools];

      logger.debug('Tools updated mid-run', {
        clientId: session.clientId,
        toolCount: session.tools.length,
        clientToolCount: updatedClientTools.length,
        mcpToolCount: existingRemoteTools.length,
        serverToolCount: existingServerTools.length,
        toolNames: session.tools.map(t => t.name),
      });
    }

    // Update session state if client sent updated state
    // This allows mid-run state updates (e.g., after navigation to a new page)
    if (state !== undefined) {
      session.state = state;
      logger.debug('State updated mid-run', {
        clientId: session.clientId,
      });
    }

    const resolver = session.pendingToolCalls.get(toolCallId);

    if (resolver) {
      resolver(content);
      session.pendingToolCalls.delete(toolCallId);
    }
  }

  private handleToolApprovalResponse(session: ClientSession, message: ToolApprovalResponseMessage) {
    const { toolCallId, approved, reason } = message.data;
    const resolver = session.pendingToolApprovals.get(toolCallId);

    if (resolver) {
      resolver({ approved, reason });
      session.pendingToolApprovals.delete(toolCallId);
      logger.info('Tool approval response received', {
        clientId: session.clientId,
        toolCallId,
        approved,
        reason,
      });
    } else {
      logger.warn('No pending approval found for tool call', {
        clientId: session.clientId,
        toolCallId,
      });
    }
  }

  private handleAbortRun(session: ClientSession, message: AbortRunMessage) {
    const { runId } = message.data;
    // Abort pending tool calls/approvals via AbortController (rejects their promises)
    abortRun(session.abortController, new RunAbortedByUser());
    // Clear pending tool calls and approvals for this run
    session.pendingToolCalls.clear();
    session.pendingToolApprovals.clear();
    session.currentRunId = undefined;

    logger.info('Run aborted', { clientId: session.clientId, runId });
  }

  private sendEvent<T = unknown>(socket: Socket, event: T) {
    if (socket.connected) {
      socket.emit('event', event);
    }
  }

  /**
   * Gets MCP tools for a session, using caching with authentication headers.
   * Lazily fetches tools on first request, then caches per-session.
   *
   * Cache is invalidated when:
   * 1. Headers hash changes (different user/token)
   * 2. TTL expires (if configured per endpoint)
   *
   * @param session - The client session
   * @param mcpHeaders - Optional MCP headers map with per-endpoint auth headers
   * @returns Array of remote tool definitions from all MCP endpoints
   */
  private async getMcpToolsForSession(
    session: ClientSession,
    mcpHeaders?: McpHeadersMap
  ): Promise<RemoteToolDefinition[]> {
    const headersHash = this.hashMcpHeaders(mcpHeaders);
    const now = Date.now();

    // Check if cache is valid
    const cacheValid = this.isMcpToolsCacheValid(session, headersHash, now);

    if (cacheValid && session.mcpToolsCache) {
      logger.debug('[MCP] Using cached tools for session', {
        clientId: session.clientId,
        toolCount: Array.from(session.mcpToolsCache.values()).flat().length,
      });
      return Array.from(session.mcpToolsCache.values()).flat() as RemoteToolDefinition[];
    }

    // Fetch tools from all endpoints
    const toolsCache = new Map<string, ToolDefinition[]>();

    for (const endpoint of this.mcpEndpoints) {
      const headers = this.resolveHeadersForEndpoint(endpoint.getUrl(), mcpHeaders);
      try {
        const tools = await endpoint.fetchToolsWithHeaders(headers);
        toolsCache.set(endpoint.getUrl(), tools);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[MCP] Failed to fetch tools from ${endpoint.getUrl()}`, { error: message });
        toolsCache.set(endpoint.getUrl(), []); // Empty on error, don't block
      }
    }

    // Update session cache
    session.mcpToolsCache = toolsCache;
    session.mcpHeadersHash = headersHash;
    session.mcpToolsCacheTimestamp = now;

    logger.debug('[MCP] Fetched and cached tools for session', {
      clientId: session.clientId,
      toolCount: Array.from(toolsCache.values()).flat().length,
      endpoints: Array.from(toolsCache.keys()),
    });

    return Array.from(toolsCache.values()).flat() as RemoteToolDefinition[];
  }

  /**
   * Checks if the MCP tools cache is still valid for a session.
   *
   * @param session - The client session
   * @param currentHeadersHash - Hash of current auth headers
   * @param now - Current timestamp
   * @returns true if cache is valid, false if refresh is needed
   */
  private isMcpToolsCacheValid(
    session: ClientSession,
    currentHeadersHash: string,
    now: number
  ): boolean {
    // No cache exists
    if (!session.mcpToolsCache || !session.mcpToolsCacheTimestamp) {
      return false;
    }

    // Headers changed (different user/token)
    if (session.mcpHeadersHash !== currentHeadersHash) {
      logger.debug('[MCP] Cache invalid: headers changed', {
        clientId: session.clientId,
        oldHash: session.mcpHeadersHash?.substring(0, 8),
        newHash: currentHeadersHash.substring(0, 8),
      });
      return false;
    }

    // Check TTL for each endpoint
    for (const endpoint of this.mcpEndpoints) {
      const ttl = endpoint.getToolsCacheTtl();
      if (ttl > 0) {
        const age = now - session.mcpToolsCacheTimestamp;
        if (age >= ttl) {
          logger.debug('[MCP] Cache invalid: TTL expired', {
            clientId: session.clientId,
            endpoint: endpoint.getUrl(),
            ttl,
            age,
          });
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Creates a hash of MCP headers for use as a cache key.
   *
   * @param mcpHeaders - Optional MCP headers map
   * @returns Hash string (16 chars), or 'no-auth' if no headers
   */
  private hashMcpHeaders(mcpHeaders?: McpHeadersMap): string {
    if (!mcpHeaders || Object.keys(mcpHeaders).length === 0) {
      return 'no-auth';
    }

    // Create stable JSON representation (sorted keys)
    const sortedEntries = Object.entries(mcpHeaders)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pattern, config]) => {
        const sortedHeaders = Object.entries(config.headers || {})
          .sort(([a], [b]) => a.localeCompare(b));
        return [pattern, { headers: Object.fromEntries(sortedHeaders) }];
      });

    return createHash('sha256')
      .update(JSON.stringify(sortedEntries))
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Resolves headers for a specific MCP endpoint from the headers map.
   *
   * @param endpointUrl - The endpoint URL to match
   * @param mcpHeaders - Optional MCP headers map
   * @returns Headers to use for this endpoint (empty object if no match)
   */
  private resolveHeadersForEndpoint(
    endpointUrl: string,
    mcpHeaders?: McpHeadersMap
  ): Record<string, string> {
    if (!mcpHeaders) {
      return {};
    }

    const matchingConfig = findMatch(endpointUrl, mcpHeaders);
    return matchingConfig?.headers || {};
  }

  /**
   * Closes the server and cleans up resources.
   * Stops accepting new connections and terminates all existing connections.
   */
  public async close() {
    clearInterval(this.cleanupInterval);

    // Clean up all MCP endpoints
    this.mcpEndpoints.forEach(endpoint => endpoint.destroy());

    // Flush telemetry from all agents before closing
    await Promise.all(
      Object.values(this.agents).map(agent => agent.flushTelemetry?.())
    );

    // Close all plugins
    await Promise.all(
      this.plugins.map(plugin => plugin.close?.())
    );

    this.io.close();
    if (this.serverHandle) {
      this.serverHandle.stop();
      this.serverHandle = null;
    }
  }
}
