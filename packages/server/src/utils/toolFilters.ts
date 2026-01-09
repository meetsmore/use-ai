import type { ToolDefinition } from '../types';
import type { RemoteToolDefinition } from '../mcp';
import { matchesPattern } from './patternMatcher';

/**
 * Type guard to check if a tool is a remote MCP tool.
 *
 * @param tool - Tool definition to check
 * @returns True if tool has MCP remote provider, false otherwise
 *
 * @example
 * ```typescript
 * if (isRemoteTool(tool)) {
 *   // tool is RemoteToolDefinition with _remote property
 *   await tool._remote.provider.executeTool(...);
 * }
 * ```
 */
export function isRemoteTool(tool: ToolDefinition): tool is RemoteToolDefinition {
  return (tool as RemoteToolDefinition)._remote !== undefined;
}

/**
 * Combines multiple filter functions with AND logic.
 * All filters must return true for the tool to pass.
 *
 * @param filters - Filter functions to combine
 * @returns Combined filter function
 *
 * @example
 * ```typescript
 * const agent = new AISDKAgent({
 *   model: anthropic('claude-3-5-sonnet-20241022'),
 *   toolFilter: and(
 *     createMcpGlobAllowFilter(['db_*']),
 *     (tool) => tool.description.includes('read-only')
 *   )
 * });
 * ```
 */
export function and(...filters: Array<(tool: ToolDefinition) => boolean>): (tool: ToolDefinition) => boolean {
  return (tool: ToolDefinition) => filters.every(f => f(tool));
}

/**
 * Combines multiple filter functions with OR logic.
 * At least one filter must return true for the tool to pass.
 *
 * @param filters - Filter functions to combine
 * @returns Combined filter function
 *
 * @example
 * ```typescript
 * const agent = new AISDKAgent({
 *   model: anthropic('claude-3-5-sonnet-20241022'),
 *   toolFilter: or(
 *     createMcpGlobAllowFilter(['db_*']),
 *     createMcpGlobAllowFilter(['file_*'])
 *   )
 * });
 * ```
 */
export function or(...filters: Array<(tool: ToolDefinition) => boolean>): (tool: ToolDefinition) => boolean {
  return (tool: ToolDefinition) => filters.some(f => f(tool));
}

/**
 * Inverts a filter function with NOT logic.
 *
 * @param filter - Filter function to invert
 * @returns Inverted filter function
 *
 * @example
 * ```typescript
 * // Block MCP tools matching delete patterns (equivalent to disallow filter)
 * const agent = new AISDKAgent({
 *   model: anthropic('claude-3-5-sonnet-20241022'),
 *   toolFilter: and(
 *     or(not(isRemoteTool), createMcpGlobAllowFilter(['db_*'])),
 *     not(createMcpGlobAllowFilter(['*_delete']))
 *   )
 * });
 * ```
 */
export function not(filter: (tool: ToolDefinition) => boolean): (tool: ToolDefinition) => boolean {
  return (tool: ToolDefinition) => !filter(tool);
}

/**
 * Creates a filter function that matches tools by glob patterns.
 * Returns true if tool name matches any of the provided patterns.
 *
 * @param patterns - Glob patterns to match tool names (e.g., `['db_*', 'file_*']`)
 * @returns Filter function for use with `AISDKAgentConfig.toolFilter`
 *
 * @example
 * ```typescript
 * // Only allow database MCP tools (client tools always pass)
 * const agent = new AISDKAgent({
 *   model: anthropic('claude-3-5-sonnet-20241022'),
 *   toolFilter: or(not(isRemoteTool), createGlobFilter(['db_*']))
 * });
 *
 * // Allow db_* but exclude *_delete
 * const agent = new AISDKAgent({
 *   model: anthropic('claude-3-5-sonnet-20241022'),
 *   toolFilter: and(
 *     or(not(isRemoteTool), createGlobFilter(['db_*'])),
 *     not(createGlobFilter(['*_delete']))
 *   )
 * });
 * ```
 */
export function createGlobFilter(patterns: string[]): (tool: ToolDefinition) => boolean {
  return (tool) => {
    // Empty array means no tools match
    if (patterns.length === 0) return false;
    // Check if tool matches any pattern
    return patterns.some(pattern => matchesPattern(tool.name, pattern));
  };
}
