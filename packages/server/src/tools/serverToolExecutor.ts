import type { ZodIssue } from 'zod';
import type { ClientSession, EventEmitter } from '../agents/types';
import type { ServerToolDefinition, ServerToolContext } from './types';
import {
  requestUserApproval,
  type ToolArguments,
  type ToolExecutor,
  type ToolResult,
} from '../agents/toolApproval';
import { logger } from '../logger';

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
): ToolExecutor {
  return async (rawArgs, { toolCallId, argsEdited }): Promise<ToolResult> => {
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
        const prefix = argsEdited
          ? 'Tool execution denied: Edited arguments are invalid'
          : `Invalid arguments for tool ${serverTool.name}`;
        return { error: true, message: `${prefix}: ${formatZodIssues(parsed.error.issues)}` };
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

        // Runtime approvals do not accept edited arguments
        return requestUserApproval(session, events, {
          toolCallId: approvalId,
          toolCallName: serverTool.name,
          toolCallArgs: args,
          message,
          metadata,
        });
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
