/**
 * Tool approval handling for destructive tools.
 * Implements user confirmation flow before executing tools with destructiveHint annotation.
 */

import type { ClientSession, EventEmitter } from './types';
import type { ToolDefinition, ToolApprovalRequestEvent } from '../types';
import { TOOL_APPROVAL_REQUEST } from '../types';
import { getToolAnnotations } from '../utils';
import { logger } from '../logger';

/**
 * Generic tool arguments type - tools receive key-value pairs
 */
export type ToolArguments = Record<string, unknown>;

/**
 * Generic tool result type - tools can return any value
 */
export type ToolResult = unknown;

/**
 * Tool executor function signature
 */
export type ToolExecutor = (args: ToolArguments, options: { toolCallId: string }) => Promise<ToolResult>;

/**
 * Determines if a tool needs user approval before execution.
 * Uses annotations.destructiveHint from both frontend and MCP tools.
 *
 * @param toolDef - The tool definition to check
 * @returns true if the tool has destructiveHint annotation set to true
 */
export function toolNeedsApproval(toolDef: ToolDefinition): boolean {
  const annotations = getToolAnnotations(toolDef);
  return annotations?.destructiveHint === true;
}

/**
 * Waits for user approval of a tool call.
 * Returns a promise that resolves when the client responds with approval/rejection.
 *
 * @param session - The client session containing pendingToolApprovals map
 * @param toolCallId - The ID of the tool call awaiting approval
 * @returns Promise that resolves with approval result
 */
export function waitForApproval(
  session: ClientSession,
  toolCallId: string
): Promise<{ approved: boolean; reason?: string }> {
  return new Promise((resolve) => {
    session.pendingToolApprovals.set(toolCallId, resolve);
  });
}

/**
 * Creates an executor wrapper that handles user approval before execution.
 * Emits TOOL_APPROVAL_REQUEST, waits for user response, then proceeds or returns error.
 *
 * @param toolDef - The tool definition (for name and annotations)
 * @param session - The client session for approval state
 * @param events - Event emitter to send approval request to client
 * @param actualExecutor - The underlying executor to call if approved
 * @returns Wrapped executor that handles approval flow
 */
export function createApprovalWrapper(
  toolDef: ToolDefinition,
  session: ClientSession,
  events: EventEmitter,
  actualExecutor: ToolExecutor
): ToolExecutor {
  return async (args: ToolArguments, options: { toolCallId: string }): Promise<ToolResult> => {
    const annotations = getToolAnnotations(toolDef);

    logger.info('Tool requires approval', {
      toolCallId: options.toolCallId,
      toolName: toolDef.name,
    });

    // Emit approval request event to client
    events.emit<ToolApprovalRequestEvent>({
      type: TOOL_APPROVAL_REQUEST,
      toolCallId: options.toolCallId,
      toolCallName: toolDef.name,
      toolCallArgs: args,
      annotations,
      timestamp: Date.now(),
    });

    // Wait for approval from client
    const approvalResult = await waitForApproval(session, options.toolCallId);

    if (approvalResult.approved) {
      logger.info('Tool approved by user', { toolCallId: options.toolCallId });
      // Continue with actual execution
      return actualExecutor(args, options);
    } else {
      logger.info('Tool rejected by user', {
        toolCallId: options.toolCallId,
        reason: approvalResult.reason,
      });
      // Return error result that AI will see
      return {
        error: true,
        message: `Tool execution denied by user: ${approvalResult.reason || 'Action was rejected'}`,
      };
    }
  };
}
