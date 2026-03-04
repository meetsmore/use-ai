import type { ClientSession, EventEmitter } from '../agents/types';
import type { ToolApprovalRequestEvent } from '../types';
import { TOOL_APPROVAL_REQUEST } from '../types';
import type { ServerToolDefinition, ServerToolContext } from './types';
import { waitForApproval } from '../agents/toolApproval';
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
 * @param events - Event emitter for sending approval requests to client
 * @returns An async function compatible with the ToolExecutor signature
 */
export function createServerToolExecutor(
  serverTool: ServerToolDefinition,
  session: ClientSession,
  events: EventEmitter
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
      requestApproval: async ({ message, metadata }) => {
        const approvalId = `${toolCallId}-approval-${Date.now()}`;

        logger.info('[Server Tool] Runtime approval requested', {
          toolName: serverTool.name,
          toolCallId,
          approvalId,
          message,
        });

        events.emit<ToolApprovalRequestEvent>({
          type: TOOL_APPROVAL_REQUEST,
          toolCallId: approvalId,
          toolCallName: serverTool.name,
          toolCallArgs: args,
          timestamp: Date.now(),
          message,
          metadata,
        });

        return waitForApproval(session, approvalId);
      },
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
