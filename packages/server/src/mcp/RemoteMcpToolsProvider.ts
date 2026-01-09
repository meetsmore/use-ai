import type { ToolDefinition, McpHeadersMap } from '@meetsmore-oss/use-ai-core';
import type { McpEndpointConfig } from '../types';
import { logger } from '../logger';
import { findMatch } from '../utils/patternMatcher';

/**
 * Schema format returned by MCP endpoints.
 * Based on Model Context Protocol specification.
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
}

interface McpSchemaResponse {
  tools: McpToolSchema[];
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

  constructor(config: McpEndpointConfig) {
    this.config = config;
    this.url = config.url;
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
   * @param headers - User-specific auth headers from mcpHeadersProvider
   * @returns List of tools the user is authorized to access
   */
  async fetchToolsWithHeaders(headers: Record<string, string> = {}): Promise<RemoteToolDefinition[]> {
    const timeout = this.config.timeout || 30000;

    // Merge: Content-Type + server-wide headers + per-user auth headers
    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...this.config.headers,  // Server-wide headers
      ...headers,              // Per-user auth headers (override)
    };

    const hasHeaders = Object.keys(mergedHeaders).length > 2; // More than Content-Type and Accept
    if (hasHeaders) {
      const headerStr = this.formatHeaders(mergedHeaders);
      logger.debug(`[MCP] Fetching tools from ${this.url} (with headers: ${headerStr})`);
    } else {
      logger.debug(`[MCP] Fetching tools from ${this.url}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: mergedHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: Date.now(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const rpcResponse = (await response.json()) as Record<string, unknown>;

      if (rpcResponse.error) {
        const error = rpcResponse.error as { message?: string };
        throw new Error(`MCP error: ${error.message || 'Unknown error'}`);
      }

      const result = rpcResponse.result as { tools?: McpToolSchema[] } | undefined;
      const tools = result?.tools || [];

      const toolDefinitions = this.convertToToolDefinitions({ tools });
      logger.info(`[MCP] Fetched ${toolDefinitions.length} tool(s) from ${this.url}`);

      return toolDefinitions;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }

      throw error;
    }
  }

  /**
   * Converts MCP tool schemas to RemoteToolDefinition format.
   */
  private convertToToolDefinitions(schema: McpSchemaResponse): RemoteToolDefinition[] {
    return schema.tools.map((tool) => {
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
        },
        // Mark with remote execution metadata
        _remote: {
          provider: this,
          originalName: tool.name,
        },
      };

      return toolDef;
    });
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
   * @param mcpHeaders - Optional MCP headers map (per-request headers override)
   */
  async executeTool(toolName: string, args: any, mcpHeaders?: McpHeadersMap): Promise<any> {
    const timeout = this.config.timeout || 30000;

    logger.debug(`[MCP] Executing tool "${toolName}" at ${this.url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Build headers: server-wide config + per-request headers override
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...this.config.headers,  // Server-wide configured headers
    };

    // Apply per-request headers if provided and matches this endpoint
    if (mcpHeaders) {
      const matchingConfig = findMatch(this.url, mcpHeaders);

      if (matchingConfig) {
        const matchedPattern = Object.keys(mcpHeaders).find(pattern => {
          // Find which pattern matched
          const match = findMatch(this.url, { [pattern]: mcpHeaders[pattern] });
          return match !== undefined;
        });

        const headerStr = this.formatHeaders(matchingConfig.headers);
        logger.debug(`[MCP] Applying matched headers to ${this.url}`, {
          pattern: matchedPattern || 'unknown',
          headers: headerStr,
        });
        Object.assign(headers, matchingConfig.headers);
      } else {
        logger.debug(`[MCP] No matching headers found for ${this.url}`);
      }
    } else if (this.config.headers && Object.keys(this.config.headers).length > 0) {
      const headerStr = this.formatHeaders(this.config.headers);
      logger.debug(`[MCP] Using configured headers for ${this.url}`, {
        headers: headerStr,
      });
    }

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers,  // Use merged headers
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
          id: Date.now(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const rpcResponse = (await response.json()) as any;

      if (rpcResponse.error) {
        throw new Error(`MCP error: ${rpcResponse.error.message}`);
      }

      // Extract content from MCP response
      const content = rpcResponse.result?.content || [];

      // Find text content
      const textContent = content.find((c: any) => c.type === 'text');
      if (textContent) {
        // Try to parse as JSON
        try {
          return JSON.parse(textContent.text);
        } catch {
          // If not JSON, return as result object
          return { result: textContent.text };
        }
      }

      logger.debug(`[MCP] Tool "${toolName}" executed successfully`);

      return {};
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        const errorMsg = `Tool execution timeout after ${timeout}ms`;
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
   * Formats headers for logging.
   * By default, redacts all values.
   * Set DEBUG=1 environment variable to print the values.
   */
  private formatHeaders(headers: Record<string, string>): string {
    const isDebug = process.env.DEBUG === '1';
    return Object.entries(headers)
      .map(([key, value]) => `${key}: ${isDebug ? value : '*'.repeat(value.length)}`)
      .join(', ');
  }
}
