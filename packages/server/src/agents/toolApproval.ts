/**
 * Tool approval handling for destructive tools.
 * Implements user confirmation flow before executing tools with destructiveHint annotation.
 */

import type { ClientSession, EventEmitter, ToolApprovalResult } from './types';
import type { ToolDefinition, ToolApprovalRequestEvent } from '../types';
import { TOOL_APPROVAL_REQUEST } from '../types';
import { getToolAnnotations } from '../utils';
import { isRemoteTool, isServerTool } from '../utils/toolFilters';
import { validateJsonSchemaArgs } from './validateToolArgs';
import { awaitPending } from '../utils/awaitPending';
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
export type ToolExecutor = (
  args: ToolArguments,
  options: { toolCallId: string; argsEdited?: boolean },
) => Promise<ToolResult>;

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

/** Reason given when an approval carries edits its request does not accept. */
export const EDITS_NOT_ACCEPTED_REASON =
  'This approval does not accept edited arguments, so the action was not run';

/**
 * Waits for user approval of a tool call.
 * Returns a promise that resolves when the client responds with approval/rejection.
 *
 * An approval carrying `modifiedArgs` resolves as a denial unless
 * `options.acceptsModifiedArgs` is true, so edits are never silently dropped.
 *
 * @param session - The client session containing pendingToolApprovals map
 * @param toolCallId - The ID of the tool call awaiting approval
 * @param options - `acceptsModifiedArgs`: the caller applies edited arguments
 * @returns Promise that resolves with approval result
 */
export function waitForApproval(
  session: ClientSession,
  toolCallId: string,
  options: { acceptsModifiedArgs?: boolean } = {}
): Promise<ToolApprovalResult> {
  const signal = session.abortController?.signal;
  return awaitPending(session.pendingToolApprovals, toolCallId, signal).then((result) => {
    if (result.modifiedArgs !== undefined && !options.acceptsModifiedArgs) {
      return { approved: false, reason: EDITS_NOT_ACCEPTED_REASON };
    }
    return result;
  });
}

/**
 * Fields of a TOOL_APPROVAL_REQUEST event. `requestUserApproval` adds `type` and `timestamp`.
 */
export type UserApprovalRequest = Omit<ToolApprovalRequestEvent, 'type' | 'timestamp'>;

/**
 * Asks the user to approve a tool call and waits for the answer.
 * Emits TOOL_APPROVAL_REQUEST with the given fields, then calls `waitForApproval`.
 *
 * The approval accepts `modifiedArgs` only when `request.acceptsModifiedArgs` is true.
 * The event and the wait thus always agree on whether edits are accepted.
 *
 * @param session - The client session for approval state
 * @param events - Event emitter to send the approval request to the client
 * @param request - The event fields. `request.toolCallId` is also the approval key.
 * @returns Promise that resolves with the approval result
 */
export function requestUserApproval(
  session: ClientSession,
  events: EventEmitter,
  request: UserApprovalRequest
): Promise<ToolApprovalResult> {
  events.emit<ToolApprovalRequestEvent>({
    type: TOOL_APPROVAL_REQUEST,
    ...request,
    timestamp: Date.now(),
  });
  return waitForApproval(session, request.toolCallId, {
    acceptsModifiedArgs: request.acceptsModifiedArgs === true,
  });
}

/**
 * Builds the error result that the AI gets when the user rejects a tool call.
 *
 * @param reason - The reason from the user, if there is one
 */
export function deniedByUser(reason: string | undefined): { error: true; message: string } {
  return {
    error: true,
    message: `Tool execution denied by user: ${reason || 'Action was rejected'}`,
  };
}

/**
 * Validates JSON Schema for edited arguments. The server tool executor handles
 * Zod schemas so refinements and transforms run once. Client tools validate locally.
 *
 * @returns Error text when invalid, otherwise undefined.
 */
export function validateModifiedArgs(toolDef: ToolDefinition, args: unknown): string | undefined {
  if (isServerTool(toolDef)) {
    return toolDef._server.schema ? undefined : validateJsonSchemaArgs(toolDef.parameters, args, 'draft-07');
  }
  if (isRemoteTool(toolDef)) {
    return validateJsonSchemaArgs(toolDef._remote.inputSchema, args, '2020-12');
  }
  return undefined;
}

/**
 * Validates edited arguments for a tool the server executes.
 *
 * @returns the error result to give the AI when they are invalid (the tool must
 * not run), otherwise undefined
 */
export function denyInvalidModifiedArgs(
  toolDef: ToolDefinition,
  modifiedArgs: ToolArguments,
  toolCallId: string
): { error: true; message: string } | undefined {
  const errorText = validateModifiedArgs(toolDef, modifiedArgs);
  if (errorText === undefined) return undefined;
  logger.info('Edited tool arguments rejected', { toolCallId, toolName: toolDef.name, errorText });
  return {
    error: true,
    message: `Tool execution denied: Edited arguments are invalid: ${errorText}`,
  };
}

/**
 * Creates an executor wrapper that handles user approval before execution.
 * Emits TOOL_APPROVAL_REQUEST, waits for user response, then proceeds or returns error.
 *
 * An approval may carry `modifiedArgs`: the tool then runs with them instead of the
 * AI's arguments. For server and MCP tools they are validated against the tool's
 * input schema first, and invalid ones return an error result without running the
 * tool. Client tools run in the browser, which validates them with the tool's own schema.
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

    // Emit approval request event to client and wait for the answer
    const approvalResult = await requestUserApproval(session, events, {
      toolCallId: options.toolCallId,
      toolCallName: toolDef.name,
      toolCallArgs: args,
      annotations,
      acceptsModifiedArgs: true,
    });

    if (approvalResult.approved) {
      const { modifiedArgs } = approvalResult;
      logger.info('Tool approved by user', {
        toolCallId: options.toolCallId,
        modifiedArgs: modifiedArgs !== undefined,
      });
      if (modifiedArgs === undefined) {
        return actualExecutor(args, options);
      }
      const invalid = denyInvalidModifiedArgs(toolDef, modifiedArgs, options.toolCallId);
      if (invalid) return invalid;
      return actualExecutor(modifiedArgs, { ...options, argsEdited: true });
    } else {
      logger.info('Tool rejected by user', {
        toolCallId: options.toolCallId,
        reason: approvalResult.reason,
      });
      // Return error result that AI will see
      return deniedByUser(approvalResult.reason);
    }
  };
}
