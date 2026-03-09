/**
 * MCP tool runtime interactive approval (`_use_ai_type: "confirmation_required"`).
 *
 * When an MCP tool returns this type the server shows an approval dialog.
 * If the user approves, the server re-calls the same tool with
 * `{ ...originalArgs, ...additional_columns }`.
 */

import type { ClientSession, EventEmitter } from '../agents/types';
import type { ToolApprovalRequestEvent } from '../types';
import { TOOL_APPROVAL_REQUEST } from '../types';
import { waitForApproval } from '../agents/toolApproval';
import type { RemoteMcpToolsProvider } from './RemoteMcpToolsProvider';
import type { McpHeadersMap } from '@meetsmore-oss/use-ai-core';
import type { McpConfirmationResponse } from '@meetsmore-oss/use-ai-core';
import { logger } from '../logger';

export {
  isMcpConfirmationResponse,
  type McpConfirmationResponse,
} from '@meetsmore-oss/use-ai-core';

/**
 * Handles an MCP confirmation response:
 * 1. Emits TOOL_APPROVAL_REQUEST to the client
 * 2. Waits for user approval via waitForApproval()
 * 3. If approved → re-calls the same tool with { ...originalArgs, ...additional_columns }
 * 4. If rejected → returns error result
 *
 * Phase-2 results are returned as-is (no re-interception).
 */
export async function handleMcpConfirmation(
  confirmation: McpConfirmationResponse,
  toolCallId: string,
  toolCallName: string,
  originalToolName: string,
  originalArgs: Record<string, unknown>,
  provider: RemoteMcpToolsProvider,
  session: ClientSession,
  events: EventEmitter,
  mcpHeaders?: McpHeadersMap
): Promise<unknown> {
  const { message, metadata, additional_columns } = confirmation._use_ai_metadata;

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
  });

  // Wait for user response
  const approvalResult = await waitForApproval(session, toolCallId);

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

  // Phase 2: re-call the same tool with original args merged with additional_columns
  const phase2Args = additional_columns
    ? { ...originalArgs, ...additional_columns }
    : originalArgs;

  logger.info('[MCP] Confirmation approved, executing phase 2', {
    toolCallId,
    originalToolName,
  });

  try {
    const result = await provider.executeTool(
      originalToolName,
      phase2Args,
      mcpHeaders
    );
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[MCP] Phase 2 execution failed', {
      toolCallId,
      originalToolName,
      error: errorMsg,
    });
    return {
      error: true,
      message: `MCP confirmation execution failed: ${errorMsg}`,
    };
  }
}
