import type { ToolDefinition, McpHeadersMap, ToolAnnotations } from '@meetsmore-oss/use-ai-core';
import type { McpEndpointConfig } from '../types';
import { logger } from '../logger';
import { findMcpHeadersForUrl } from './mcpHeaderPatterns';
import { McpHttpClient, McpRequestTimeoutError } from './McpHttpClient';
import { buildMcpParamHeaders, readMcpParamHeaders, type McpParamHeader } from './mcpParamHeaders';
import { extractFilesFromMcpContent, USE_AI_FILES, type McpContentPart } from './mcpToolResultFiles';

/**
 * Schema format returned by MCP endpoints.
 * Based on Model Context Protocol specification.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/tools
 */
interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  /** MCP tool annotations for UI hints */
  annotations?: ToolAnnotations;
}

/**
 * Server-only extension of ToolDefinition with remote execution metadata.
 * This type is used internally by the server and never exposed to the client.
 * The actual execute function is created in AISDKAgent where EventEmitter is available.
 */
export interface RemoteToolDefinition extends ToolDefinition {
  /** Remote execution metadata for MCP tools */
  _remote: {
    /** The provider that manages this tool */
    provider: RemoteMcpToolsProvider;
    /** The original tool name (before namespace prefix) */
    originalName: string;
    /** The complete input schema used to validate edited arguments. */
    inputSchema: object;
    /** Header annotations from this specific tool listing. */
    paramHeaders?: readonly McpParamHeader[];
    /** MCP tool annotations (title, hints, etc.) */
    annotations?: ToolAnnotations;
  };
}

/**
 * Manages fetching and executing tools from a single MCP endpoint.
 * Each instance handles one endpoint independently, allowing for separate failure handling.
 *
 * Tools are fetched lazily on first request (not at server startup) to support
 * per-user authentication headers for tool filtering.
 */
export class RemoteMcpToolsProvider {
  private readonly url: string;
  private readonly config: McpEndpointConfig;
  private readonly client: McpHttpClient;

  constructor(config: McpEndpointConfig) {
    this.config = config;
    this.url = config.url;
    this.client = new McpHttpClient(config.url, config.timeout || 30000, config.protocolVersion);
  }

  /**
   * Simply logs that the MCP endpoint is configured.
   */
  async initialize(): Promise<void> {
    logger.info(`[MCP] Configured MCP endpoint: ${this.url}`);
  }

  /**
   * Fetches tools from MCP endpoint with authentication headers.
   * Called on first run_agent request per session (lazy loading).
   *
   * @param headers - User-specific auth headers from forwardedPropsProvider
   * @returns List of tools the user is authorized to access
   */
  async fetchToolsWithHeaders(headers: Record<string, string> = {}): Promise<RemoteToolDefinition[]> {
    const mergedHeaders = this.buildHeaders(headers);

    const hasHeaders = Object.keys(mergedHeaders).length > 2; // More than Content-Type and Accept
    if (hasHeaders) {
      const headerStr = this.formatHeaders(mergedHeaders);
      logger.debug(`[MCP] Fetching tools from ${this.url} (with headers: ${headerStr})`);
    } else {
      logger.debug(`[MCP] Fetching tools from ${this.url}`);
    }

    const rpcResponse = await this.client.request('tools/list', undefined, { headers: mergedHeaders });
    if (rpcResponse.error) {
      const error = rpcResponse.error as { message?: string };
      throw new Error(`MCP error: ${error.message || 'Unknown error'}`);
    }

    const result = rpcResponse.result as { tools?: McpToolSchema[] } | undefined;
    const toolDefinitions = this.convertToToolDefinitions(result?.tools || []);
    logger.info(`[MCP] Fetched ${toolDefinitions.length} tool(s) from ${this.url}`);

    return toolDefinitions;
  }

  /**
   * Converts MCP tool schemas to RemoteToolDefinition format.
   */
  private convertToToolDefinitions(tools: McpToolSchema[]): RemoteToolDefinition[] {
    const definitions: RemoteToolDefinition[] = [];
    for (const tool of tools) {
      const paramHeaders = this.config.protocolVersion ? readMcpParamHeaders(tool.inputSchema) : undefined;
      if (typeof paramHeaders === 'string') {
        logger.warn(`[MCP] Excluding tool "${tool.name}" from ${this.url}: ${paramHeaders}`);
        continue;
      }

      // Apply namespace prefix if configured
      const name = this.config.namespace ? `${this.config.namespace}_${tool.name}` : tool.name;

      // Create tool definition with remote metadata
      const toolDef: RemoteToolDefinition = {
        name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.inputSchema.properties,
          required: tool.inputSchema.required,
          ...(tool.inputSchema.$defs !== undefined && { $defs: tool.inputSchema.$defs as Record<string, unknown> }),
          ...(tool.inputSchema.definitions !== undefined && { definitions: tool.inputSchema.definitions as Record<string, unknown> }),
        },
        // Mark with remote execution metadata
        _remote: {
          provider: this,
          originalName: tool.name,
          inputSchema: tool.inputSchema,
          ...(paramHeaders?.length ? { paramHeaders } : {}),
          annotations: tool.annotations,
        },
      };

      // Pass through annotations if present
      if (tool.annotations) {
        toolDef.annotations = tool.annotations;
      }

      definitions.push(toolDef);
    }
    return definitions;
  }

  /**
   * Gets the configured cache TTL for this endpoint.
   * Returns 0 if not configured (cache for entire session).
   */
  getToolsCacheTtl(): number {
    return this.config.toolsCacheTtl || 0;
  }

  /**
   * Executes a tool on the remote MCP endpoint using JSON-RPC.
   *
   * @param toolName - The name of the tool to execute
   * @param args - Arguments to pass to the tool
   * @param mcpHeaders - Optional per-request authentication headers
   * @param paramHeaders - Header annotations from the selected tool definition
   */
  async executeTool(
    toolName: string,
    args: any,
    mcpHeaders?: McpHeadersMap,
    paramHeaders?: readonly McpParamHeader[],
  ): Promise<any> {
    logger.debug(`[MCP] Executing tool "${toolName}" at ${this.url}`);

    const matchingConfig = mcpHeaders ? findMcpHeadersForUrl(this.url, mcpHeaders) : undefined;
    if (mcpHeaders && !matchingConfig) {
      logger.debug(`[MCP] No matching headers found for ${this.url}`);
    }
    const headers = this.buildHeaders(matchingConfig?.headers);
    logger.debug(`[MCP] Request headers for ${this.url}`, {
      headers: this.formatHeaders(headers),
    });

    try {
      const extraHeaders = paramHeaders && buildMcpParamHeaders(args, paramHeaders);
      const rpcResponse = await this.client.request(
        'tools/call',
        { name: toolName, arguments: args },
        { headers, extraHeaders },
      ) as {
        error?: { message: string };
        result?: { content?: McpContentPart[] };
      };

      if (rpcResponse.error) {
        throw new Error(`MCP error: ${rpcResponse.error.message}`);
      }

      // Extract content from MCP response
      const content = rpcResponse.result?.content || [];
      const files = extractFilesFromMcpContent(content);

      // Find text content
      const textContent = content.find((c) => c.type === 'text');
      let result: unknown = {};
      if (textContent) {
        // Try to parse as JSON
        try {
          result = JSON.parse(textContent.text ?? '');
        } catch {
          // If not JSON, return as result object
          result = { result: textContent.text };
        }
      }

      logger.debug(`[MCP] Tool "${toolName}" executed successfully`);

      if (files.length === 0) {
        return result;
      }

      // Images and PDFs ride along under USE_AI_FILES; AISDKAgent hands them to
      // the model and keeps them out of the history and logs.
      const base =
        typeof result === 'object' && result !== null && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : { result };
      return { ...base, [USE_AI_FILES]: files };
    } catch (error) {
      if (error instanceof McpRequestTimeoutError) {
        const errorMsg = `Tool execution timeout after ${error.timeout}ms`;
        logger.error(`[MCP] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[MCP] Tool execution failed: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Cleans up resources.
   * Should be called when the server shuts down.
   */
  destroy(): void {
    logger.debug(`[MCP] Destroying provider for ${this.url}`);
  }

  /**
   * Gets the endpoint URL.
   */
  getUrl(): string {
    return this.url;
  }

  /**
   * Builds request headers from the client-supplied headers and the server config.
   * Client headers are limited to `allowedClientHeaders`, and can never replace a
   * header the server configures, so a client cannot change the identity, tenant or
   * scope that the server-side config pins.
   */
  private buildHeaders(clientHeaders: Record<string, string> = {}): Record<string, string> {
    const serverHeaders = this.config.headers ?? {};
    const allowed = new Set(
      (this.config.allowedClientHeaders ?? ['authorization']).map(name => name.toLowerCase())
    );
    // Header names are case-insensitive, so `authorization` from the client must not
    // be sent next to a server-configured `Authorization`.
    const serverNames = new Set(Object.keys(serverHeaders).map(name => name.toLowerCase()));

    const accepted: Record<string, string> = {};
    const dropped: string[] = [];
    for (const [name, value] of Object.entries(clientHeaders)) {
      const lower = name.toLowerCase();
      if (allowed.has(lower) && !serverNames.has(lower)) {
        accepted[name] = value;
      } else {
        dropped.push(name);
      }
    }
    if (dropped.length > 0) {
      logger.warn(`[MCP] Dropped client headers not allowed for ${this.url}`, { headers: dropped });
    }

    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...accepted,
      ...serverHeaders,
    };
  }

  /**
   * Formats headers for logging.
   * By default, redacts all values without revealing their length, since they carry user
   * JWTs and server keys. Set DEBUG=1 to print the values (local development only).
   */
  private formatHeaders(headers: Record<string, string>): string {
    const isDebug = process.env.DEBUG === '1';
    return Object.entries(headers)
      .map(([key, value]) => `${key}: ${isDebug ? value : '[REDACTED]'}`)
      .join(', ');
  }
}
