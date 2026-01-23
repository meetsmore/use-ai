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

// Re-export ClientSession type for external use
export type { ClientSession } from './agents/types';

/**
 * Configuration for BunUseAIServer.
 * Extends UseAIServerConfig with Bun-specific options.
 */
export interface BunUseAIServerConfig extends UseAIServerConfig {
  /**
   * Idle timeout in seconds for the Bun server.
   * Must be greater than the pingInterval option (25 seconds by default).
   * Default: 30
   */
  idleTimeout?: number;
}

/**
 * Bun-native WebSocket server that coordinates between client applications and AI agents.
 * Uses @socket.io/bun-engine for optimal performance with Bun's native HTTP server.
 *
 * This server is specifically designed for Bun runtime and uses Bun's native
 * WebSocket implementation instead of relying on Node.js HTTP polyfill.
 *
 * @example
 * ```typescript
 * import { BunUseAIServer, AISDKAgent } from '@meetsmore-oss/use-ai-server';
 * import { createAnthropic } from '@ai-sdk/anthropic';
 *
 * const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 * const claudeAgent = new AISDKAgent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 * });
 *
 * const { server, bunConfig } = BunUseAIServer.create({
 *   port: 8081,
 *   agents: { claude: claudeAgent },
 *   defaultAgent: 'claude',
 * });
 *
 * // Export the Bun server configuration for Bun.serve()
 * export default bunConfig;
 * ```
 */
export class BunUseAIServer {
  private io: SocketIOServer;
  private engine: BunEngine;
  private agent: Agent;
  private defaultAgentId: string;
  private agents: Record<string, Agent>;
  private clients: Map<string, ClientSession> = new Map();
  private config: Required<Omit<UseAIServerConfig, 'defaultAgent' | 'agents' | 'plugins' | 'mcpEndpoints' | 'maxHttpBufferSize' | 'cors'>> & {
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

  private constructor(config: BunUseAIServerConfig) {
    this.config = {
      port: config.port ?? 8081,
      rateLimitMaxRequests: config.rateLimitMaxRequests ?? 0,
      rateLimitWindowMs: config.rateLimitWindowMs ?? 60000,
      maxHttpBufferSize: config.maxHttpBufferSize ?? 20 * 1024 * 1024,
      cors: config.cors,
      idleTimeout: config.idleTimeout ?? 30,
    };

    this.agents = config.agents;

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

    // Create RemoteMcpToolsProvider instances
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
  }

  /**
   * Creates a new BunUseAIServer instance and returns both the server
   * and the Bun configuration to be exported as the default module.
   *
   * @param config - Server configuration options
   * @returns Object containing the server instance and Bun configuration
   *
   * @example
   * ```typescript
   * const { server, bunConfig } = BunUseAIServer.create({
   *   port: 8081,
   *   agents: { claude: claudeAgent },
   *   defaultAgent: 'claude',
   * });
   *
   * export default bunConfig;
   * ```
   */
  static create(config: BunUseAIServerConfig): { server: BunUseAIServer; bunConfig: object } {
    const server = new BunUseAIServer(config);
    const bunConfig = server.getBunConfig();
    return { server, bunConfig };
  }

  /**
   * Returns the Bun server configuration.
   * This should be exported as the default module for Bun.serve().
   */
  getBunConfig() {
    const handler = this.engine.handler();

    // Build CORS headers based on config
    const getCorsHeaders = (origin: string | null): Record<string, string> => {
      const headers: Record<string, string> = {};

      if (this.config.cors) {
        const corsOrigin = this.config.cors.origin;
        if (corsOrigin === true || corsOrigin === '*') {
          headers['Access-Control-Allow-Origin'] = origin || '*';
        } else if (typeof corsOrigin === 'string') {
          headers['Access-Control-Allow-Origin'] = corsOrigin;
        } else if (Array.isArray(corsOrigin) && origin && corsOrigin.includes(origin)) {
          headers['Access-Control-Allow-Origin'] = origin;
        }

        if (this.config.cors.credentials) {
          headers['Access-Control-Allow-Credentials'] = 'true';
        }

        if (this.config.cors.methods) {
          const methods = Array.isArray(this.config.cors.methods)
            ? this.config.cors.methods.join(', ')
            : this.config.cors.methods;
          headers['Access-Control-Allow-Methods'] = methods;
        }

        headers['Access-Control-Allow-Headers'] = 'Content-Type';
      } else {
        // No CORS config provided - minimal defaults (apps should configure CORS explicitly)
        headers['Access-Control-Allow-Origin'] = origin || '*';
        headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type';
      }

      return headers;
    };

    return {
      port: this.config.port,
      idleTimeout: this.config.idleTimeout,
      fetch: async (req: Request, server: Parameters<typeof this.engine.handleRequest>[1]) => {
        const url = new URL(req.url);
        const origin = req.headers.get('Origin');
        const corsHeaders = getCorsHeaders(origin);

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: corsHeaders,
          });
        }

        // Health check endpoint
        if (url.pathname === '/health') {
          return new Response(JSON.stringify({ status: 'ok' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        // Socket.IO path
        if (url.pathname.startsWith('/socket.io/')) {
          const response = await this.engine.handleRequest(req, server);

          // Add CORS headers to Socket.IO responses
          if (response) {
            const newHeaders = new Headers(response.headers);
            for (const [key, value] of Object.entries(corsHeaders)) {
              newHeaders.set(key, value);
            }
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders,
            });
          }
          return response;
        }

        return new Response('Not Found', { status: 404, headers: corsHeaders });
      },
      websocket: handler.websocket,
    };
  }

  /**
   * Initializes the server by fetching MCP tools from all endpoints.
   */
  async initialize(): Promise<void> {
    if (this.mcpEndpoints.length > 0) {
      logger.info('[MCP] Initializing MCP endpoints', { count: this.mcpEndpoints.length });

      const results = await Promise.allSettled(
        this.mcpEndpoints.map(endpoint => endpoint.initialize())
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed > 0) {
        logger.warn('[MCP] Some endpoints failed to initialize', { successful, failed });
      } else {
        logger.info('[MCP] All endpoints initialized successfully', { count: successful });
      }
    }
  }

  private initializePlugins() {
    for (const plugin of this.plugins) {
      logger.info('Initializing plugin', { pluginName: plugin.getName() });

      plugin.registerHandlers({
        registerMessageHandler: this.registerMessageHandler.bind(this),
      });
    }
  }

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
      const ipAddress = socket.handshake.address || socket.id;
      const transport = socket.conn.transport.name;
      logger.info('Client connected', { clientId, threadId, ipAddress, transport });

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

      const availableAgents = Object.entries(this.agents).map(([id, agent]) => ({
        id,
        name: agent.getName?.() || id,
        annotation: agent.getAnnotation?.(),
      }));
      socket.emit('agents', {
        agents: availableAgents,
        defaultAgent: this.defaultAgentId,
      });

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

        for (const plugin of this.plugins) {
          plugin.onClientDisconnect?.(session);
        }

        this.clients.delete(socket.id);
      });
    });

    logger.info('BunUseAI server ready', { port: this.config.port });
  }

  private async handleClientMessage(socket: Socket, message: UseAIClientMessage) {
    const session = this.clients.get(socket.id);
    if (!session) return;

    const pluginHandler = this.messageHandlers.get(message.type);
    if (pluginHandler) {
      await pluginHandler(session, message);
      return;
    }

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

    const mcpHeaders = forwardedProps?.mcpHeaders as McpHeadersMap | undefined;
    const requestedAgent = forwardedProps?.agent as string | undefined;

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

    if (session.threadId && session.threadId !== threadId) {
      logger.info('ThreadId changed, clearing conversation history', {
        oldThreadId: session.threadId,
        newThreadId: threadId,
      });
      session.conversationHistory = [];
    }
    session.threadId = threadId;
    session.currentRunId = runId;
    session.currentMcpHeaders = mcpHeaders;

    const clientTools = tools.map(t => ({
      ...t,
      parameters: t.parameters || { type: 'object', properties: {}, required: [] },
    })) as ToolDefinition[];

    let mcpTools: RemoteToolDefinition[] = [];
    if (this.mcpEndpoints.length > 0) {
      mcpTools = await this.getMcpToolsForSession(session, mcpHeaders);
    }

    session.tools = [...clientTools, ...mcpTools];

    if (mcpTools.length > 0) {
      logger.debug('[MCP] Merged tools', {
        clientTools: clientTools.length,
        mcpTools: mcpTools.length,
        total: session.tools.length,
      });
    }

    session.state = state;

    type TextBlock = { type: 'text'; text: string };
    type ImageBlock = { type: 'image'; url: string };
    type FileBlock = { type: 'file'; url: string; mimeType: string; name?: string };
    type ContentBlock = TextBlock | ImageBlock | FileBlock | { type: string; [key: string]: unknown };
    type MessageContent = string | ContentBlock[] | Record<string, unknown> | undefined;

    type AISDKTextPart = { type: 'text'; text: string };
    type AISDKImagePart = { type: 'image'; image: string };
    type AISDKFilePart = { type: 'file'; data: string; mediaType: string };
    type AISDKContentPart = AISDKTextPart | AISDKImagePart | AISDKFilePart;

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

    const getStringContent = (content: MessageContent): string => {
      if (!content) return '';
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .filter((block): block is TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');
      }
      if (typeof content === 'object') {
        return JSON.stringify(content);
      }
      return '';
    };

    const convertToAISDKContent = (content: MessageContent): string | AISDKContentPart[] => {
      if (!content) return '';
      if (typeof content === 'string') return content;

      if (Array.isArray(content)) {
        const parts: AISDKContentPart[] = [];

        for (const block of content) {
          if (block.type === 'text' && 'text' in block) {
            parts.push({ type: 'text', text: block.text as string });
          } else if (block.type === 'image' && 'url' in block) {
            parts.push({ type: 'image', image: block.url as string });
          } else if (block.type === 'file' && 'url' in block) {
            parts.push({
              type: 'file',
              data: block.url as string,
              mediaType: (block.mimeType as string) || 'application/octet-stream',
            });
          } else if (block.type === 'transformed_file' && 'text' in block) {
            const originalFile = (block as { originalFile?: { name?: string; mimeType?: string } }).originalFile;
            const fileName = originalFile?.name || 'file';
            const mimeType = originalFile?.mimeType || 'application/octet-stream';
            parts.push({
              type: 'text',
              text: `[Content of file "${fileName}" (${mimeType})]:\n\n${block.text as string}`,
            });
          }
        }

        if (parts.length === 1 && parts[0].type === 'text') {
          return parts[0].text;
        }

        return parts.length > 0 ? parts : '';
      }

      if (typeof content === 'object') {
        return JSON.stringify(content);
      }
      return '';
    };

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
        const content = getStringContent(msg.content);
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
      return {
        role: 'user' as const,
        content: convertToAISDKContent(msg.content),
      };
    });

    if (session.conversationHistory.length === 0) {
      session.conversationHistory = incomingMessages;
    } else {
      const existingUserMessageCount = session.conversationHistory.filter(msg => msg.role === 'user').length;
      const incomingUserMessages = incomingMessages.filter(msg => msg.role === 'user');
      const newUserMessages = incomingUserMessages.slice(existingUserMessageCount);
      session.conversationHistory.push(...newUserMessages);
    }

    const systemPrompt = this.buildSystemPrompt(session, state);

    const eventEmitter: EventEmitter = {
      emit: <T extends AGUIEvent>(event: T) => {
        this.sendEvent(session.socket, event);
      },
    };

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
      delete session.currentMcpHeaders;
    }
  }

  private buildSystemPrompt(session: ClientSession, state: unknown): string | undefined {
    const parts: string[] = [];

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
    session.pendingToolCalls.clear();
    session.currentRunId = undefined;

    logger.info('Run aborted', { clientId: session.clientId, runId });
  }

  private sendEvent<T = unknown>(socket: Socket, event: T) {
    if (socket.connected) {
      socket.emit('event', event);
    }
  }

  private async getMcpToolsForSession(
    session: ClientSession,
    mcpHeaders?: McpHeadersMap
  ): Promise<RemoteToolDefinition[]> {
    const headersHash = this.hashMcpHeaders(mcpHeaders);
    const now = Date.now();

    const cacheValid = this.isMcpToolsCacheValid(session, headersHash, now);

    if (cacheValid && session.mcpToolsCache) {
      logger.debug('[MCP] Using cached tools for session', {
        clientId: session.clientId,
        toolCount: Array.from(session.mcpToolsCache.values()).flat().length,
      });
      return Array.from(session.mcpToolsCache.values()).flat() as RemoteToolDefinition[];
    }

    const toolsCache = new Map<string, ToolDefinition[]>();

    for (const endpoint of this.mcpEndpoints) {
      const headers = this.resolveHeadersForEndpoint(endpoint.getUrl(), mcpHeaders);
      try {
        const tools = await endpoint.fetchToolsWithHeaders(headers);
        toolsCache.set(endpoint.getUrl(), tools);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[MCP] Failed to fetch tools from ${endpoint.getUrl()}`, { error: message });
        toolsCache.set(endpoint.getUrl(), []);
      }
    }

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

  private isMcpToolsCacheValid(
    session: ClientSession,
    currentHeadersHash: string,
    now: number
  ): boolean {
    if (!session.mcpToolsCache || !session.mcpToolsCacheTimestamp) {
      return false;
    }

    if (session.mcpHeadersHash !== currentHeadersHash) {
      logger.debug('[MCP] Cache invalid: headers changed', {
        clientId: session.clientId,
        oldHash: session.mcpHeadersHash?.substring(0, 8),
        newHash: currentHeadersHash.substring(0, 8),
      });
      return false;
    }

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

  private hashMcpHeaders(mcpHeaders?: McpHeadersMap): string {
    if (!mcpHeaders || Object.keys(mcpHeaders).length === 0) {
      return 'no-auth';
    }

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
   */
  public close() {
    clearInterval(this.cleanupInterval);
    this.mcpEndpoints.forEach(endpoint => endpoint.destroy());
    this.io.close();
  }
}
