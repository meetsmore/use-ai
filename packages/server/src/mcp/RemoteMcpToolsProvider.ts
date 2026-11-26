import type { ToolDefinition, McpHeadersMap, ToolAnnotations } from '@meetsmore-oss/use-ai-core';
import type { McpEndpointConfig } from '../types';
import { logger } from '../logger';
import { findMcpHeadersForUrl } from './mcpHeaderPatterns';

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
  /** `x-mcp-header` parameters of each listed tool, by original tool name. */
  private readonly paramHeaders = new Map<string, McpParamHeader[]>();

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
   * @param headers - User-specific auth headers from forwardedPropsProvider
   * @returns List of tools the user is authorized to access
   */
  async fetchToolsWithHeaders(headers: Record<string, string> = {}): Promise<RemoteToolDefinition[]> {
    const timeout = this.config.timeout || 30000;

    const mergedHeaders = this.buildHeaders(headers);

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
      const rpcResponse = await this.post('tools/list', {}, mergedHeaders, controller.signal);

      clearTimeout(timeoutId);

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
    const tools = this.config.protocolVersion
      ? schema.tools.filter((tool) => {
          const paramHeaders = readMcpParamHeaders(tool.inputSchema);
          if (typeof paramHeaders === 'string') {
            logger.warn(`[MCP] Excluding tool "${tool.name}" from ${this.url}: ${paramHeaders}`);
            return false;
          }
          this.paramHeaders.set(tool.name, paramHeaders);
          return true;
        })
      : schema.tools;

    return tools.map((tool) => {
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
          annotations: tool.annotations,
        },
      };

      // Pass through annotations if present
      if (tool.annotations) {
        toolDef.annotations = tool.annotations;
      }

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

    const matchingConfig = mcpHeaders ? findMcpHeadersForUrl(this.url, mcpHeaders) : undefined;
    if (mcpHeaders && !matchingConfig) {
      logger.debug(`[MCP] No matching headers found for ${this.url}`);
    }
    const headers = this.buildHeaders(matchingConfig?.headers);
    logger.debug(`[MCP] Request headers for ${this.url}`, {
      headers: this.formatHeaders(headers),
    });

    try {
      const rpcResponse = (await this.post(
        'tools/call',
        { name: toolName, arguments: args },
        headers,
        controller.signal
      )) as any;

      clearTimeout(timeoutId);

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
   * Sends one JSON-RPC request over Streamable HTTP and returns the JSON-RPC response.
   * With `protocolVersion` configured, adds the `MCP-Protocol-Version`, `Mcp-Method` and
   * `Mcp-Name` headers and the required `io.modelcontextprotocol/*` fields in `params._meta`.
   * Reads either an `application/json` body or a `text/event-stream` body.
   * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
   */
  private async post(
    method: string,
    params: Record<string, unknown>,
    headers: Record<string, string>,
    signal: AbortSignal
  ): Promise<Record<string, unknown>> {
    const id = Date.now();
    const version = this.config.protocolVersion;
    const requestHeaders = { ...headers };
    let requestParams: Record<string, unknown> | undefined =
      Object.keys(params).length > 0 ? params : undefined;

    if (version) {
      requestHeaders['MCP-Protocol-Version'] = version;
      requestHeaders['Mcp-Method'] = method;
      if (typeof params.name === 'string') {
        requestHeaders['Mcp-Name'] = encodeMcpHeaderValue(params.name);
      }
      if (method === 'tools/call' && typeof params.name === 'string') {
        for (const { header, path } of this.paramHeaders.get(params.name) ?? []) {
          let value: unknown = params.arguments;
          for (const key of path) {
            value = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
          }
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            requestHeaders[`Mcp-Param-${header}`] = encodeMcpHeaderValue(String(value));
          }
        }
      }
      requestParams = {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': version,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      };
    }

    const finished = new AbortController();
    const response = await fetch(this.url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        ...(requestParams ? { params: requestParams } : {}),
        id,
      }),
      signal: AbortSignal.any([signal, finished.signal]),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('text/event-stream')) {
      try {
        return await readSseResponse(response.body, id);
      } finally {
        // Closes the connection when the server keeps the stream open after the response.
        finished.abort();
      }
    }
    return (await response.json()) as Record<string, unknown>;
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

interface McpParamHeader {
  /** Name portion of the `Mcp-Param-{name}` header */
  header: string;
  /** Chain of `properties` keys from the schema root to the annotated property */
  path: string[];
}

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HEADER_TYPES = new Set(['string', 'integer', 'boolean']);

/**
 * Collects the `x-mcp-header` annotations of a tool input schema.
 * Returns the reason when an annotation breaks a constraint of the spec: not an HTTP token,
 * not case-insensitively unique, not on a string, integer or boolean property, or not
 * statically reachable from the root through `properties` keys only.
 * @see https://modelcontextprotocol.io/specification/2026-07-28/server/tools#x-mcp-header
 */
function readMcpParamHeaders(schema: unknown): McpParamHeader[] | string {
  const found: McpParamHeader[] = [];
  const seen = new Set<string>();
  let reachable = 0;

  const visitProperties = (node: unknown, path: string[]): string | undefined => {
    const properties = (node as { properties?: unknown } | null)?.properties;
    if (properties === null || typeof properties !== 'object') return undefined;
    for (const [key, property] of Object.entries(properties)) {
      if (property === null || typeof property !== 'object') continue;
      if ('x-mcp-header' in property) {
        reachable++;
        const header = (property as Record<string, unknown>)['x-mcp-header'];
        const type = (property as Record<string, unknown>).type;
        if (typeof header !== 'string' || !HTTP_TOKEN.test(header)) {
          return `x-mcp-header ${JSON.stringify(header)} is not an HTTP header token`;
        }
        if (seen.has(header.toLowerCase())) return `x-mcp-header "${header}" is not unique`;
        if (typeof type !== 'string' || !HEADER_TYPES.has(type)) {
          return `x-mcp-header "${header}" is on a property of type ${JSON.stringify(type)}`;
        }
        seen.add(header.toLowerCase());
        found.push({ header, path: [...path, key] });
      }
      const error = visitProperties(property, [...path, key]);
      if (error) return error;
    }
    return undefined;
  };

  const countAll = (node: unknown, isPropertiesMap = false): number => {
    if (node === null || typeof node !== 'object') return 0;
    let count = 0;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'x-mcp-header' && !isPropertiesMap && !Array.isArray(node)) count++;
      count += countAll(value, key === 'properties' && !isPropertiesMap && !Array.isArray(node));
    }
    return count;
  };

  const error = visitProperties(schema, []);
  if (error) return error;
  if (countAll(schema) > reachable) return 'x-mcp-header is on a property that is not statically reachable';
  return found;
}

/**
 * Encodes a value for the `Mcp-Name` or `Mcp-Param-*` header: plain when it is printable ASCII without
 * leading or trailing whitespace and does not look like the sentinel, otherwise
 * `=?base64?{UTF-8 bytes in Base64}?=`.
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#value-encoding
 */
function encodeMcpHeaderValue(value: string): string {
  const plain =
    /^[\x20-\x7E\t]*$/.test(value) &&
    value === value.trim() &&
    !(value.startsWith('=?base64?') && value.endsWith('?='));
  return plain ? value : `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Reads a `text/event-stream` body until the JSON-RPC response with the given id arrives.
 * Events with empty data (such as priming events), comment lines and notifications are skipped.
 * Unlike the event-stream spec, an unterminated last event at the end of the stream is still read.
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 */
async function readSseResponse(
  body: ReadableStream<Uint8Array> | null,
  id: number
): Promise<Record<string, unknown>> {
  let data: string[] = [];

  const readLine = (line: string): Record<string, unknown> | undefined => {
    if (line === '') {
      const text = data.join('\n');
      data = [];
      if (text === '') return undefined;
      const message = JSON.parse(text) as Record<string, unknown>;
      return message.id === id && ('result' in message || 'error' in message) ? message : undefined;
    }
    if (line === 'data' || line.startsWith('data:')) {
      const value = line.slice(5);
      data.push(value.startsWith(' ') ? value.slice(1) : value);
    }
    return undefined;
  };

  if (body) {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let afterCr = false;
    for (;;) {
      const { value, done } = await reader.read();
      let chunk = done ? '\n\n' : value;
      // An LF right after a CR that ended the previous chunk is the second half of a CRLF.
      if (afterCr && chunk.startsWith('\n')) chunk = chunk.slice(1);
      afterCr = chunk.endsWith('\r');
      if (chunk === '') continue;
      buffer += chunk;
      if (!/[\r\n]/.test(chunk)) continue;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop()!;
      for (const line of lines) {
        const message = readLine(line);
        if (message) return message;
      }
      if (done) break;
    }
  }

  throw new Error('SSE stream ended without a JSON-RPC response');
}
