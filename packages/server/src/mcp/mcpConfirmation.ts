/**
 * MCP tool runtime interactive approval (`_use_ai_type: "confirmation_required"`).
 *
 * When an MCP tool returns this type the server shows an approval dialog.
 * If the user approves, the server re-calls the same tool with
 * `{ ...originalArgs, ...additional_columns }`. When the approval carried edited
 * arguments, phase 1 runs again with them, so the tool confirms them itself.
 */

import type { ClientSession, EventEmitter } from '../agents/types';
import type { ToolApprovalRequestEvent } from '../types';
import { TOOL_APPROVAL_REQUEST } from '../types';
import { waitForApproval, denyInvalidModifiedArgs } from '../agents/toolApproval';
import type { RemoteToolDefinition } from './RemoteMcpToolsProvider';
import type { McpHeadersMap } from '@meetsmore-oss/use-ai-core';
import { isMcpConfirmationResponse, type McpConfirmationResponse } from '@meetsmore-oss/use-ai-core';
import { logger } from '../logger';

export {
  isMcpConfirmationResponse,
  type McpConfirmationResponse,
} from '@meetsmore-oss/use-ai-core';

/**
 * Handles an MCP confirmation response:
 * 1. Emits TOOL_APPROVAL_REQUEST to the client
 * 2. Waits for user approval via waitForApproval()
 * 3. If approved → re-calls the same tool with { ...originalArgs, ...additional_columns }.
 *    When the approval carries modifiedArgs, they are validated against the tool's
 *    input schema (JSON Schema 2020-12; invalid ones return an error result) and phase 1 runs again
 *    with them. A new confirmation_required starts this flow over with the edited args;
 *    any other result is returned. Phase 2 only ever runs args phase 1 confirmed.
 * 4. If rejected → returns error result
 *
 * Phase-2 results are returned as-is (no re-interception).
 */
export async function handleMcpConfirmation(
  confirmation: McpConfirmationResponse,
  toolCallId: string,
  tool: RemoteToolDefinition,
  originalArgs: Record<string, unknown>,
  session: ClientSession,
  events: EventEmitter,
  mcpHeaders?: McpHeadersMap
): Promise<unknown> {
  const { message, metadata, additional_columns } = confirmation._use_ai_metadata;
  const { provider, originalName: originalToolName, paramHeaders } = tool._remote;
  const toolCallName = tool.name;

  logger.info('[MCP] Tool returned confirmation_required', {
    toolCallId,
    toolCallName,
    message,
    originalToolName,
  });

  // Emit approval request event to the client (expose originalArgs, not internal columns)
  events.emit<ToolApprovalRequestEvent>({
    type: TOOL_APPROVAL_REQUEST,
    toolCallId,
    toolCallName,
    toolCallArgs: originalArgs,
    message,
    metadata,
    timestamp: Date.now(),
    acceptsModifiedArgs: true,
  });

  // Wait for user response
  const approvalResult = await waitForApproval(session, toolCallId, { acceptsModifiedArgs: true });

  if (!approvalResult.approved) {
    logger.info('[MCP] Confirmation rejected by user', {
      toolCallId,
      reason: approvalResult.reason,
    });
    return {
      error: true,
      message: `Tool execution denied by user: ${approvalResult.reason || 'Action was rejected'}`,
    };
  }

  const callTool = async (args: Record<string, unknown>, phase: 'phase 1' | 'phase 2') => {
    try {
      return await provider.executeTool(originalToolName, args, mcpHeaders, paramHeaders);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[MCP] ${phase} execution failed`, { toolCallId, originalToolName, error: errorMsg });
      return {
        error: true,
        message: `MCP confirmation execution failed: ${errorMsg}`,
      };
    }
  };

  const { modifiedArgs } = approvalResult;
  if (modifiedArgs !== undefined) {
    const invalid = denyInvalidModifiedArgs(tool, modifiedArgs, toolCallId);
    if (invalid) return invalid;

    // Phase 1 again: the MCP server confirms the edited args itself, so phase 2
    // never runs args phase 1 did not see.
    logger.info('[MCP] Confirmation approved with edits, re-running phase 1', { toolCallId, originalToolName });
    const result = await callTool(modifiedArgs, 'phase 1');
    if (isMcpConfirmationResponse(result)) {
      return handleMcpConfirmation(
        result, toolCallId, tool, modifiedArgs, session, events, mcpHeaders
      );
    }
    return result;
  }

  // Phase 2: re-call the same tool with the args merged with additional_columns
  const phase2Args = additional_columns
    ? { ...originalArgs, ...additional_columns }
    : originalArgs;

  logger.info('[MCP] Confirmation approved, executing phase 2', {
    toolCallId,
    originalToolName,
  });

  return callTool(phase2Args, 'phase 2');
}
