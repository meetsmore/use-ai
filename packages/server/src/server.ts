import { Server as SocketIOServer } from 'socket.io';
import type { ModelMessage } from 'ai';
import { ErrorCode, type McpHeadersMap, type UseAIForwardedProps, type ResolveAttachments } from '@meetsmore-oss/use-ai-core';
import { resolveAttachmentParts, countRefParts, dropRemoteUrlParts } from './attachmentResolution';
import { toModelMessages } from './messageConversion';
import type {
  UseAIServerConfig,
  McpEndpointConfig,
  ToolDefinition,
  UseAIClientMessage,
  RunAgentMessage,
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
import type { ClientConnection, ClientSession } from './agents/types';
import type { UseAIServerPlugin, MessageHandler, BeforeRunAuthorizedInput } from './plugins/types';
import { FeedbackPlugin } from './plugins/FeedbackPlugin';
import { isRemoteTool, isServerTool } from './utils/toolFilters';
import { abortRun, RunAbortedByUser, RunAbortedByClientDisconnect } from './utils/abortReason';
import { runError, runStarted } from './utils/runEvents';
import { RemoteMcpToolsProvider, type RemoteToolDefinition } from './mcp';
import type { ServerToolDefinition } from './tools/types';
import { McpToolCatalog } from './mcp/McpToolCatalog';
import {
  createRuntimeAdapter,
  createClientIpTracker,
  type RuntimeAdapter,
  type RuntimeServerHandle,
  type ClientIpTracker,
  type RuntimeListener,
} from './runtime';
import { SocketIOClientConnection } from './socketIOConnection';
import { WebSocketClientConnection } from './webSocketConnection';

// Re-export session types for external use
export type { ClientSession, ClientConnection } from './agents/types';

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
  private io: SocketIOServer | null = null;
  private runtimeAdapter: RuntimeAdapter;
  private serverHandle: RuntimeServerHandle | null = null;
  private agent: Agent; // Default agent for chat (run_agent)
  private defaultAgentId: string; // ID of the default agent
  private agents: Record<string, Agent>; // Registry of all agents
  private clients: Map<string, ClientSession> = new Map();
  // Sent to every client on connect; constant after construction.
  private agentsPayload: { agents: Array<{ id: string; name: string; annotation?: string }>; defaultAgent: string };
  private config: Required<Omit<UseAIServerConfig, 'defaultAgent' | 'agents' | 'plugins' | 'tools' | 'mcpEndpoints' | 'maxHttpBufferSize' | 'cors' | 'idleTimeout' | 'runtime' | 'spanProcessors' | 'resolveAttachments' | 'transport' | 'allowedOrigins'>> & {
    maxHttpBufferSize: number;
    cors?: CorsOptions;
    idleTimeout: number;
    transport: 'socketio' | 'websocket';
    allowedOrigins?: readonly string[];
  };
  private rateLimiter: RateLimiter;
  // Counts LLM calls (one for each agent step), not runs. Off when rateLimitMaxLlmCalls is 0.
  private llmCallRateLimiter: RateLimiter;
  private cleanupInterval: NodeJS.Timeout;
  private plugins: UseAIServerPlugin[] = [];
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private mcpEndpoints: RemoteMcpToolsProvider[] = [];
  private mcpToolCatalog: McpToolCatalog;
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
      rateLimitMaxLlmCalls: config.rateLimitMaxLlmCalls ?? 0,
      maxHttpBufferSize: config.maxHttpBufferSize ?? 20 * 1024 * 1024, // 20MB default
      cors: config.cors,
      idleTimeout: config.idleTimeout ?? 30,
      transport: config.transport ?? 'socketio',
      allowedOrigins: config.allowedOrigins ? [...config.allowedOrigins] : undefined,
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
    this.agentsPayload = {
      agents: Object.entries(this.agents).map(([id, agent]) => ({
        id,
        name: agent.getName?.() || id,
        annotation: agent.getAnnotation?.(),
      })),
      defaultAgent: this.defaultAgentId,
    };

    this.rateLimiter = new RateLimiter({
      maxRequests: this.config.rateLimitMaxRequests,
      windowMs: this.config.rateLimitWindowMs,
    });
    this.llmCallRateLimiter = new RateLimiter({
      maxRequests: this.config.rateLimitMaxLlmCalls,
      windowMs: this.config.rateLimitWindowMs,
    });

    // Create client IP tracker
    this.clientIpTracker = createClientIpTracker();

    this.cleanupInterval = setInterval(() => {
      this.rateLimiter.cleanup();
      this.llmCallRateLimiter.cleanup();
    }, this.config.rateLimitWindowMs);

    // Create RemoteMcpToolsProvider instances (to reference remote tools)
    if (config.mcpEndpoints && config.mcpEndpoints.length > 0) {
      this.mcpEndpoints = config.mcpEndpoints.map(endpoint => new RemoteMcpToolsProvider(endpoint));
      logger.info('[MCP] Created remote MCP instances', {
        count: this.mcpEndpoints.length,
        endpoints: this.mcpEndpoints.map(e => e.getUrl()),
      });
    }
    this.mcpToolCatalog = new McpToolCatalog(this.mcpEndpoints);

    // Convert server tools config to ServerToolDefinition[]
    if (config.tools) {
      this.serverTools = Object.entries(config.tools).map(([name, toolConfig]) => ({
        name,
        description: toolConfig.description,
        parameters: toolConfig.parameters,
        annotations: toolConfig.annotations,
        _server: {
          execute: toolConfig.execute,
          schema: toolConfig.schema,
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

    let listener: RuntimeListener;
    if (this.config.transport === 'socketio') {
      this.io = new SocketIOServer({
        transports: ['polling', 'websocket'],
        maxHttpBufferSize: this.config.maxHttpBufferSize,
      });
      this.io.on('connection', (socket) => {
        this.acceptConnection(new SocketIOClientConnection(socket, this.clientIpTracker));
      });
      listener = { transport: 'socketio', io: this.io };
    } else {
      listener = {
        transport: 'websocket',
        onConnection: (socket) => this.acceptConnection(new WebSocketClientConnection(`ws-${uuidv4()}`, socket)),
      };
    }

    if (this.rateLimiter.isEnabled()) {
      logger.info('Rate limiting enabled', {
        maxRequests: this.config.rateLimitMaxRequests,
        windowMs: this.config.rateLimitWindowMs,
      });
    }
    if (this.llmCallRateLimiter.isEnabled()) {
      logger.info('LLM call rate limiting enabled', {
        maxLlmCalls: this.config.rateLimitMaxLlmCalls,
        windowMs: this.config.rateLimitWindowMs,
      });
    }

    this.serverHandle = this.runtimeAdapter.createServer(listener, {
      port: this.config.port,
      idleTimeout: this.config.idleTimeout,
      cors: this.config.cors,
      allowedOrigins: this.config.allowedOrigins,
      maxHttpBufferSize: this.config.maxHttpBufferSize,
      onPollingConnection: (sessionId, ip) => {
        this.clientIpTracker.trackPollingConnection(sessionId, ip);
      },
      onPollingClose: (sessionId) => {
        this.clientIpTracker.removePollingConnection(sessionId);
      },
    });
    logger.info('UseAI server ready', { port: this.config.port, transport: this.config.transport });
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
   * @param type - The message type to handle (e.g., 'message_feedback')
   * @param handler - The handler function to call when this message type is received
   */
  public registerMessageHandler(type: string, handler: MessageHandler): void {
    if (this.messageHandlers.has(type)) {
      logger.warn('Overwriting existing message handler', { type });
    }

    this.messageHandlers.set(type, handler);
    logger.debug('Registered message handler', { type });
  }

  private acceptConnection(connection: ClientConnection) {
    const session = this.createSession(connection);
    logger.info('Client connected', {
      clientId: session.clientId,
      threadId: session.threadId,
      ipAddress: session.ipAddress,
    });

    connection.onMessage((message: unknown) => {
      // Client input is untrusted: a message without a string `type` (e.g. `null`) cannot be dispatched.
      if (typeof message !== 'object' || message === null || typeof (message as { type?: unknown }).type !== 'string') {
        logger.warn('Discarding malformed message', { clientId: session.clientId });
        return;
      }
      // A rejection escaping here would be unhandled and terminate the process for every tenant.
      this.receiveClientMessage(session, message as UseAIClientMessage).catch((error: unknown) => {
        logger.error('Unhandled error while handling message', {
          error: error instanceof Error ? error.message : 'Unknown error',
          clientId: session.clientId,
        });
      });
    });

    connection.onClose(() => {
      logger.info('Client disconnected', { clientId: session.clientId, ipAddress: session.ipAddress });
      this.destroySession(session);
    });
  }

  /**
   * Creates the session for a newly accepted connection and announces the server's
   * agents to it.
   */
  private createSession(connection: ClientConnection): ClientSession {
    const session: ClientSession = {
      // Random, not a per-process counter: a counter repeats across pods and restarts,
      // which merges unrelated clients under one Langfuse session or Dify user.
      clientId: `client-${uuidv4()}`,
      ipAddress: connection.ipAddress,
      socket: connection,
      threadId: uuidv4(),
      tools: [],
      state: null,
      pendingToolCalls: new Map(),
      pendingToolApprovals: new Map(),
    };

    this.clients.set(connection.id, session);

    connection.emit('agents', this.agentsPayload);

    for (const plugin of this.plugins) {
      plugin.onClientConnect?.(session);
    }

    return session;
  }

  /**
   * Tears down a session whose connection has gone away.
   * Rate limiting persists by IP address across connections, so it is not reset here.
   */
  private destroySession(session: ClientSession) {
    // Abort any pending tool calls/approvals for this session
    abortRun(session.abortController, new RunAbortedByClientDisconnect());

    for (const plugin of this.plugins) {
      plugin.onClientDisconnect?.(session);
    }

    this.clients.delete(session.socket.id);
  }

  /**
   * Runs a client message and reports anything it throws back to that client.
   */
  private async receiveClientMessage(session: ClientSession, message: UseAIClientMessage) {
    try {
      await this.handleClientMessage(session, message);
    } catch (error) {
      logger.error('Error handling message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        clientId: session.clientId,
      });
      if (message.type === 'run_agent') {
        const runAgentData = (message as RunAgentMessage).data;
        const unhandledForwardedProps = runAgentData?.forwardedProps as UseAIForwardedProps | undefined;
        recordErrorTrace({
          runId: runAgentData?.runId || session.socket.id,
          errorCategory: 'unhandled_error',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          sessionId: session.clientId,
          threadId: runAgentData?.threadId,
          ipAddress: session.ipAddress,
          metadata: { ...unhandledForwardedProps?.telemetryMetadata },
        });
      }
      // The raw message may expose internal details (hostnames, stack info); it is logged above.
      this.sendEvent(session.socket, runError(ErrorCode.UNKNOWN_ERROR));
    }
  }

  private async handleClientMessage(session: ClientSession, message: UseAIClientMessage) {
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
          metadata: { ...forwardedProps?.telemetryMetadata, requestedAgent, availableAgents },
        });
        this.sendEvent(session.socket, runError(`Agent "${requestedAgent}" not found. Available agents: ${availableAgents.join(', ')}`));
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
        metadata: { ...forwardedProps?.telemetryMetadata, retryAfterSeconds },
      });
      this.sendEvent(session.socket, runError(`Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds.`));
      return;
    }

    // Update session
    session.threadId = threadId;
    session.currentRunId = runId;

    // Create AbortController for this run (used to cancel pending tool calls/approvals on disconnect)
    // Kept locally too: another run_agent on this session may replace it while a hook awaits.
    const runAbortController = new AbortController();
    session.abortController = runAbortController;

    // beforeRunAuthorized hooks run before any external call, so a rejected run cannot
    // trigger MCP tools/list or attachment resolution.
    const beforeRunAuthorizedInput: BeforeRunAuthorizedInput = {
      session,
      runId,
      originalInput: message.data,
      mcpHeaders: forwardedProps?.mcpHeaders,
    };
    for (const plugin of this.plugins) {
      if (plugin.beforeRunAuthorized) {
        const result = await plugin.beforeRunAuthorized(beforeRunAuthorizedInput);
        if (result?.abort) {
          session.currentRunId = undefined;
          this.sendEvent(session.socket, runError(result.message));
          return;
        }
      }
    }
    // A disconnect or abort_run may arrive while a hook awaits (e.g. an identity provider call).
    if (runAbortController.signal.aborted) {
      logger.info('Run cancelled before start', { clientId: session.clientId, runId });
      // The client resets its run state on RUN_ERROR(ABORTED) after sending abort_run, and takes
      // the turn's start position from RUN_STARTED. The agent has not run yet, so send it here.
      this.sendEvent(session.socket, runStarted(threadId, runId));
      this.sendEvent(session.socket, runError(ErrorCode.ABORTED));
      return;
    }
    const mcpHeaders = beforeRunAuthorizedInput.mcpHeaders;

    session.tools = await this.mergeRunTools(session, tools, mcpHeaders);
    session.state = state;

    const incomingMessages = await this.prepareModelMessages(runId, messages, forwardedProps);

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
      mcpHeaders,
      // Uses the same key as the run rate limit above.
      llmCallLimit: this.llmCallRateLimiter.isEnabled()
        ? { consume: () => this.llmCallRateLimiter.checkLimit(session.ipAddress) }
        : undefined,
    };

    // Run beforeRunAgent hooks from all plugins
    for (const plugin of this.plugins) {
      if (plugin.beforeRunAgent) {
        const result = await plugin.beforeRunAgent(agentInput);
        if (result?.abort) {
          this.sendEvent(session.socket, runError(result.message));
          return;
        }
      }
    }

    // Delegate to selected agent
    await selectedAgent.run(agentInput, eventEmitter);
  }

  /**
   * Merges the client tools of a run with the MCP tools and the server tools.
   * MCP tools are fetched lazily and cached for each session.
   */
  private async mergeRunTools(
    session: ClientSession,
    tools: RunAgentMessage['data']['tools'],
    mcpHeaders: McpHeadersMap | undefined,
  ): Promise<ToolDefinition[]> {
    // Merge client tools with MCP tools from all endpoints
    const clientTools = tools.map(t => ({
      ...t,
      parameters: t.parameters || { type: 'object', properties: {}, required: [] },
    })) as ToolDefinition[];

    // Lazy fetch MCP tools (per-session caching with auth headers)
    let mcpTools: RemoteToolDefinition[] = [];
    if (this.mcpEndpoints.length > 0) {
      mcpTools = await this.mcpToolCatalog.getToolsForSession(session, mcpHeaders);
    }

    // Merge: client tools + MCP tools + server tools
    const merged = [...clientTools, ...mcpTools, ...this.serverTools];

    if (mcpTools.length > 0 || this.serverTools.length > 0) {
      logger.debug('Merged tools', {
        clientTools: clientTools.length,
        mcpTools: mcpTools.length,
        serverTools: this.serverTools.length,
        total: merged.length,
      });
    }

    return merged;
  }

  /**
   * Prepares the run messages for the agent:
   * 1. Drops client-supplied remote attachment urls.
   * 2. Resolves attachment refs with the host resolver.
   * 3. Converts AG-UI messages to AI SDK model messages.
   */
  private async prepareModelMessages(
    runId: string,
    messages: Message[],
    forwardedProps: UseAIForwardedProps | undefined,
  ): Promise<ModelMessage[]> {
    // Before resolving refs, so that urls from the trusted resolver are not filtered.
    const { messages: safeMessages, dropped: droppedUrlParts } = dropRemoteUrlParts(messages);
    if (droppedUrlParts > 0) {
      logger.warn('Dropped client-supplied attachment urls that would be fetched by the server', {
        runId,
        droppedUrlParts,
      });
    }

    // Resolve refs once at run start, before AI SDK conversion (not per step; see ResolveAttachments for the contract).
    let resolvedMessages = safeMessages;
    let resolveErrored = false;
    if (this.resolveAttachments) {
      try {
        resolvedMessages = await resolveAttachmentParts(safeMessages, this.resolveAttachments, { forwardedProps });
      } catch (error) {
        // A resolver failure must not bring down the whole run. Degrade and continue unresolved
        // (respond with text only), dropping the attachment; the WARN below records it.
        resolveErrored = true;
        logger.error('resolveAttachments failed; proceeding without resolved attachments', {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
        resolvedMessages = safeMessages;
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

    return toModelMessages(resolvedMessages);
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
    const { toolCallId, approved, reason, modifiedArgs } = message.data;
    const resolver = session.pendingToolApprovals.get(toolCallId);

    if (resolver) {
      if (approved && modifiedArgs !== undefined) {
        const isObject = typeof modifiedArgs === 'object' && modifiedArgs !== null && !Array.isArray(modifiedArgs);
        resolver(isObject
          ? { approved, reason, modifiedArgs }
          : { approved: false, reason: 'modifiedArgs must be a JSON object' });
      } else {
        resolver({ approved, reason });
      }
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

  private sendEvent<T = unknown>(connection: ClientConnection, event: T) {
    connection.emit('event', event);
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

    this.io?.close();
    if (this.serverHandle) {
      this.serverHandle.stop();
      this.serverHandle = null;
    }
  }
}
