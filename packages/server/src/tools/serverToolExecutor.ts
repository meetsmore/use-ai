import type { ClientSession } from '../agents/types';
import type { ServerToolDefinition, ServerToolContext } from './types';
import { logger } from '../logger';

/** Generic tool arguments type */
type ToolArguments = Record<string, unknown>;
/** Generic tool result type */
type ToolResult = unknown;

/**
 * Creates an execute function for server-side tools.
 * Unlike client tools (promise-based waiting) or MCP tools (HTTP call),
 * server tools execute directly in-process.
 *
 * @param serverTool - The server tool definition with execute function
 * @param session - The client session (for context)
 * @returns An async function compatible with the ToolExecutor signature
 */
export function createServerToolExecutor(
  serverTool: ServerToolDefinition,
  session: ClientSession
): (args: ToolArguments, options: { toolCallId: string }) => Promise<ToolResult> {
  return async (args: ToolArguments, { toolCallId }): Promise<ToolResult> => {
    logger.info('[Server Tool] Executing', {
      toolName: serverTool.name,
      toolCallId,
    });

    const context: ServerToolContext = {
      session,
      state: session.state,
      runId: session.currentRunId || '',
      toolCallId,
    };

    try {
      const result = await serverTool._server.execute(args, context);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('[Server Tool] Execution failed', {
        toolName: serverTool.name,
        toolCallId,
        error: errorMsg,
      });
      throw error;
    }
  };
}
