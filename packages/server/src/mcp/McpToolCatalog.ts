import { createHash } from 'crypto';
import type { McpHeadersMap } from '@meetsmore-oss/use-ai-core';
import type { ClientSession } from '../agents/types';
import type { ToolDefinition } from '../types';
import { logger } from '../logger';
import { findMcpHeadersForUrl } from './mcpHeaderPatterns';
import type { RemoteMcpToolsProvider, RemoteToolDefinition } from './RemoteMcpToolsProvider';

/**
 * Lists the tools of all MCP endpoints and caches them for each session.
 *
 * Tools are fetched lazily on the first run of a session, with the auth headers of that run.
 * The cache is kept on the session (`mcpToolsCache`, `mcpHeadersHash`, `mcpToolsCacheTimestamp`).
 */
export class McpToolCatalog {
  constructor(private readonly endpoints: readonly RemoteMcpToolsProvider[]) {}

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
  async getToolsForSession(
    session: ClientSession,
    mcpHeaders?: McpHeadersMap
  ): Promise<RemoteToolDefinition[]> {
    const headersHash = hashMcpHeaders(mcpHeaders);
    const now = Date.now();

    // Check if cache is valid
    const cacheValid = this.isCacheValid(session, headersHash, now);

    if (cacheValid && session.mcpToolsCache) {
      logger.debug('[MCP] Using cached tools for session', {
        clientId: session.clientId,
        toolCount: Array.from(session.mcpToolsCache.values()).flat().length,
      });
      return Array.from(session.mcpToolsCache.values()).flat() as RemoteToolDefinition[];
    }

    // Fetch tools from all endpoints
    const toolsCache = new Map<string, ToolDefinition[]>();

    for (const endpoint of this.endpoints) {
      const headers = resolveHeadersForEndpoint(endpoint.getUrl(), mcpHeaders);
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
  private isCacheValid(
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
    for (const endpoint of this.endpoints) {
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
}

/**
 * Creates a hash of MCP headers for use as a cache key.
 *
 * @param mcpHeaders - Optional MCP headers map
 * @returns Hash string (16 chars), or 'no-auth' if no headers
 */
export function hashMcpHeaders(mcpHeaders?: McpHeadersMap): string {
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
function resolveHeadersForEndpoint(
  endpointUrl: string,
  mcpHeaders?: McpHeadersMap
): Record<string, string> {
  if (!mcpHeaders) {
    return {};
  }

  const matchingConfig = findMcpHeadersForUrl(endpointUrl, mcpHeaders);
  return matchingConfig?.headers || {};
}
