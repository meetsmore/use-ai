import type { ToolDefinition, ToolAnnotations } from '../types';
import type { ClientSession } from '../agents/types';

/**
 * Context provided to server tool execute functions.
 * Gives tools access to session state and run metadata.
 */
export interface ServerToolContext {
  /** The client session that triggered the tool call */
  session: ClientSession;
  /** Current application state from the client */
  state: unknown;
  /** Unique identifier for the current run */
  runId: string;
  /** Unique identifier for this specific tool call */
  toolCallId: string;
}

/**
 * Server-side execute function signature.
 * Can be sync or async.
 */
export type ServerToolExecuteFn = (
  args: Record<string, unknown>,
  context: ServerToolContext
) => unknown | Promise<unknown>;

/**
 * User-facing configuration for a server tool.
 * Returned by defineServerTool().
 */
export interface ServerToolConfig {
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema parameters (converted from Zod by defineServerTool) */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** The function to execute when the AI calls this tool */
  execute: ServerToolExecuteFn;
  /** MCP-aligned annotations for tool behavior hints */
  annotations?: ToolAnnotations;
}

/**
 * Internal tool definition with server execution metadata.
 * Extends ToolDefinition with _server marker (mirrors RemoteToolDefinition._remote pattern).
 */
export interface ServerToolDefinition extends ToolDefinition {
  /** Server execution metadata */
  _server: {
    /** The execute function to call when the AI invokes this tool */
    execute: ServerToolExecuteFn;
  };
}
