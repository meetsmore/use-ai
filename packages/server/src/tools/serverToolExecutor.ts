import type { ZodIssue } from 'zod';
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

/** Formats a Zod issue path as `args/a/b`, the same in the log and in the error result. */
function formatIssuePath(issue: ZodIssue): string {
  return ['args', ...issue.path].join('/');
}

/** Formats Zod issues as `args/path message`, for the error result the AI reads. */
function formatZodIssues(issues: ZodIssue[]): string {
  return issues
    .map((issue) => `${formatIssuePath(issue)} ${issue.message}`)
    .join(', ');
}

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
  return async (rawArgs: ToolArguments, { toolCallId }): Promise<ToolResult> => {
    // The AI SDK passes tool input through without checking it against the schema,
    // so the tool's own Zod schema is the only check before execute runs.
    let args = rawArgs;
    const schema = serverTool._server.schema;
    if (schema) {
      const parsed = await schema.safeParseAsync(rawArgs);
      if (!parsed.success) {
        // Issue messages can quote the received value, so only paths and codes are logged.
        logger.warn('[Server Tool] Invalid arguments, not executing', {
          toolName: serverTool.name,
          toolCallId,
          issues: parsed.error.issues.map((issue) => ({ path: formatIssuePath(issue), code: issue.code })),
        });
        return {
          error: true,
          message: `Invalid arguments for tool ${serverTool.name}: ${formatZodIssues(parsed.error.issues)}`,
        };
      }
      args = parsed.data as ToolArguments;
    }

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
