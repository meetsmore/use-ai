import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as BunEngine } from '@socket.io/bun-engine';
import { ModelMessage, ToolModelMessage } from 'ai';
import { createHash } from 'crypto';
import { EventType, type McpHeadersMap } from '@meetsmore-oss/use-ai-core';
import type {
  UseAIServerConfig,
  McpEndpointConfig,
  ToolDefinition,
  UseAIClientMessage,
  RunAgentMessage,
  RunWorkflowMessage,
  ToolResultMessage,
  AbortRunMessage,
  Message,
  AGUIEvent,
  CorsOptions,
} from './types';
import { RateLimiter } from './rateLimiter';
import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';
import type { Agent, EventEmitter } from './agents/types';
import type { ClientSession } from './agents/types';
import type { UseAIServerPlugin, MessageHandler } from './plugins/types';
import { RemoteMcpToolsProvider, type RemoteToolDefinition } from './mcp';
import { findMatch } from './utils/patternMatcher';
import { createBunConfig } from './bun-config';

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
 *   model: anthropic('claude-sonnet-4-20250514'),
 * });
 * const server = new UseAIServer({
 *   port: 8081,
 *   agents: { claude: claudeAgent },
 *   defaultAgent: 'claude', // Default agent name
 * });
 *
 * // Multiple agents (Claude + OpenAI)
 * const gptAgent = new AISDKAgent({
 *   model: openai('gpt-4-turbo'),
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
  private engine: BunEngine;
  private agent: Agent; // Default agent for chat (run_agent)
  private defaultAgentId: string; // ID of the default agent
  private agents: Record<string, Agent>; // Registry of all agents
  private clients: Map<string, ClientSession> = new Map();
  private config: Required<Omit<UseAIServerConfig, 'defaultAgent' | 'agents' | 'plugins' | 'mcpEndpoints' | 'maxHttpBufferSize' | 'cors' | 'idleTimeout'>> & {
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
  private bunServer: ReturnType<typeof Bun.serve> | null = null;
  // Store client IP addresses for polling transport (keyed by session ID)
  // WebSocket transport can use BunWebSocket.remoteAddress directly
  private pollingClientIps: Map<string, string> = new Map();

  /**
   * Creates a new UseAI server instance.
   *
   * @param config - Server configuration options
   * @throws Error if the specified agent name does not exist in the agents map
   */
  constructor(config: UseAIServerConfig) {
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

    // Initialize plugins
    this.plugins = config.plugins ?? [];
    this.initializePlugins();

    // Create Bun-native engine
    // Note: bun-engine has its own CORS handling separate from socket.io
    this.engine = new BunEngine({
      path: '/socket.io/',
    });

    // Capture client IP for polling transport at engine connection time
    // For WebSocket, BunWebSocket.remoteAddress is available directly (no need to store here)
    // For polling, server.requestIP() works because there's no WebSocket upgrade
    this.engine.on('connection', (engineSocket, req, bunServer) => {
      // Only store for polling - WebSocket uses BunWebSocket.remoteAddress
      if (engineSocket.transport?.name === 'polling') {
        const clientIp = bunServer.requestIP(req);
        if (clientIp) {
          this.pollingClientIps.set(engineSocket.id, clientIp.address);
        }
      }
    });

    // Create Socket.IO server and bind to Bun engine
    this.io = new SocketIOServer({
      transports: ['polling', 'websocket'],
      maxHttpBufferSize: this.config.maxHttpBufferSize,
    });
    this.io.bind(this.engine);

    this.setupSocketIOServer();

    if (this.rateLimiter.isEnabled()) {
      logger.info('Rate limiting enabled', {
        maxRequests: this.config.rateLimitMaxRequests,
        windowMs: this.config.rateLimitWindowMs,
      });
    }

    // Auto-start Bun server
    this.bunServer = Bun.serve(
      createBunConfig(this.engine, {
        port: this.config.port,
        idleTimeout: this.config.idleTimeout,
        cors: this.config.cors,
      })
    );
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
      // Note: Type assertions needed because socket.io uses engine.io types,
      // but we use bun-engine which has different type definitions
      const conn = socket.conn as unknown as { id: string; transport: { name: string; socket?: { remoteAddress?: string } } };
      // Get IP address for rate limiting (Bun-native implementation):
      // - WebSocket: BunWebSocket.remoteAddress
      // - Polling: pollingClientIps map (captured in engine connection event)
      const ipAddress =
        conn.transport.socket?.remoteAddress ||
        this.pollingClientIps.get(conn.id) ||
        socket.id; // fallback to socket.id if IP cannot be determined
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
        conversationHistory: [],
        pendingToolCalls: new Map(),
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
          this.sendEvent(socket, {
            type: EventType.RUN_ERROR,
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now(),
          });
        }
      });

      socket.on('disconnect', () => {
        logger.info('Client disconnected', { clientId, ipAddress });

        // Clean up polling IP entry
        this.pollingClientIps.delete(conn.id);

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
      case 'abort_run':
        this.handleAbortRun(session, message as AbortRunMessage);
        break;
      default:
        logger.warn('Unknown message type', { type: message.type });
    }
  }

  private async handleRunAgent(session: ClientSession, message: RunAgentMessage) {
    const { threadId, runId, messages, tools, state, context, forwardedProps } = message.data;

    // Extract use-ai extensions from forwardedProps (AG-UI extension point)
    const mcpHeaders = forwardedProps?.mcpHeaders as McpHeadersMap | undefined;
    const requestedAgent = forwardedProps?.agent as string | undefined;

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
      this.sendEvent(session.socket, {
        type: EventType.RUN_ERROR,
        message: `Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds.`,
        timestamp: Date.now(),
      });
      return;
    }

    // Update session
    // If threadId changed, clear conversation history (new chat started)
    if (session.threadId && session.threadId !== threadId) {
      logger.info('ThreadId changed, clearing conversation history', {
        oldThreadId: session.threadId,
        newThreadId: threadId,
      });
      session.conversationHistory = [];
    }
    session.threadId = threadId;
    session.currentRunId = runId;

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

    // Merge: client tools + MCP tools
    session.tools = [...clientTools, ...mcpTools];

    if (mcpTools.length > 0) {
      logger.debug('[MCP] Merged tools', {
        clientTools: clientTools.length,
        mcpTools: mcpTools.length,
        total: session.tools.length,
      });
    }

    session.state = state;

    // Types for AG-UI content blocks
    type TextBlock = { type: 'text'; text: string };
    type ImageBlock = { type: 'image'; url: string };
    type FileBlock = { type: 'file'; url: string; mimeType: string; name?: string };
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
      tool_name?: string;
      toolCallId?: string;
      toolName?: string;
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
          } else if (block.type === 'image' && 'url' in block) {
            // AG-UI uses 'url', AI SDK uses 'image'
            parts.push({ type: 'image', image: block.url as string });
          } else if (block.type === 'file' && 'url' in block) {
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

    // Convert AG-UI messages to AI SDK ModelMessage format
    const incomingMessages: ModelMessage[] = messages.map(msg => {
      if (msg.role === 'user') {
        return {
          role: 'user' as const,
          content: convertToAISDKContent(msg.content),
        };
      } else if (msg.role === 'assistant') {
        return {
          role: 'assistant' as const,
          content: getStringContent(msg.content),
        };
      } else if (isToolMessage(msg)) {
        // Tool messages in AI SDK format
        const content = getStringContent(msg.content);
        // Try to parse as JSON for structured output, fallback to string
        let output: unknown;
        try {
          output = JSON.parse(content);
        } catch {
          output = content;
        }
        return {
          role: 'tool' as const,
          content: [
            {
              type: 'tool-result' as const,
              toolCallId: msg.tool_call_id || msg.toolCallId || uuidv4(),
              toolName: msg.tool_name || msg.toolName || 'unknown',
              output,
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

    // Conversation history management:
    // - The client sends ALL messages it knows about (user + assistant messages from past turns)
    // - The server maintains the authoritative history including tool results
    // - We only append NEW user messages to avoid duplicates
    if (session.conversationHistory.length === 0) {
      // First run: initialize conversation history with incoming messages
      session.conversationHistory = incomingMessages;
    } else {
      // Subsequent runs: only append NEW user messages that aren't already in the history
      // Count how many user messages we already have
      const existingUserMessageCount = session.conversationHistory.filter(msg => msg.role === 'user').length;
      const incomingUserMessages = incomingMessages.filter(msg => msg.role === 'user');

      // Only append user messages beyond what we already have
      const newUserMessages = incomingUserMessages.slice(existingUserMessageCount);

      // Append only new user messages to preserve the full conversation context
      session.conversationHistory.push(...newUserMessages);
    }

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(session, state);

    // Create event emitter that forwards all events to client
    const eventEmitter: EventEmitter = {
      emit: <T extends AGUIEvent>(event: T) => {
        this.sendEvent(session.socket, event);
      },
    };

    // Delegate to selected agent
    try {
      await selectedAgent.run(
        {
          session,
          runId,
          messages: session.conversationHistory,
          tools: session.tools,
          state,
          systemPrompt,
          originalInput: message.data,
        },
        eventEmitter
      );
    } finally {
      // Clear MCP headers after run completes (success or failure)
      delete session.currentMcpHeaders;
    }
  }

  private buildSystemPrompt(session: ClientSession, state: unknown): string | undefined {
    const parts: string[] = [];

    // Add state context if available
    if (state) {
      parts.push('You are interacting with a web application. Here is the current state:');
      parts.push('');
      parts.push(JSON.stringify(state, null, 2));
      parts.push('');
      parts.push('Use the available tools to interact with and modify the UI based on user requests.');
    }

    const confirmationTools = session.tools.filter(tool => tool.confirmationRequired);
    if (confirmationTools.length > 0) {
      if (parts.length > 0) {
        parts.push('');
      }
      parts.push('CRITICAL: The following tools require user confirmation EVERY TIME before execution:');
      parts.push('');
      confirmationTools.forEach(tool => {
        parts.push(`- ${tool.name}`);
      });
      parts.push('');
      parts.push('MANDATORY CONFIRMATION WORKFLOW:');
      parts.push('1. First, explain to the user exactly what changes will be made');
      parts.push('2. Then, explicitly ask: "Do you want me to proceed?" or similar confirmation question');
      parts.push('3. STOP and WAIT for the user to respond with explicit confirmation');
      parts.push('4. ONLY after receiving confirmation, call the tool');
      parts.push('');
      parts.push('NEVER ASSUME CONFIRMATION:');
      parts.push('- Do NOT call these tools without receiving explicit confirmation');
      parts.push('- Each destructive operation requires its own separate confirmation');
    }

    return parts.length > 0 ? parts.join('\n') : undefined;
  }

  private handleToolResult(session: ClientSession, message: ToolResultMessage) {
    const { toolCallId, content } = message.data;
    const resolver = session.pendingToolCalls.get(toolCallId);

    if (resolver) {
      resolver(content);
      session.pendingToolCalls.delete(toolCallId);
    }
  }

  private handleAbortRun(session: ClientSession, message: AbortRunMessage) {
    const { runId } = message.data;
    // Clear pending tool calls for this run
    session.pendingToolCalls.clear();
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
  public close() {
    clearInterval(this.cleanupInterval);

    // Clean up all MCP endpoints
    this.mcpEndpoints.forEach(endpoint => endpoint.destroy());

    this.io.close();
    if (this.bunServer) {
      this.bunServer.stop();
      this.bunServer = null;
    }
  }
}
