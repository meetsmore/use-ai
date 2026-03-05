/**
 * MCP tool runtime interactive approval.
 *
 * MCP tools that need user confirmation return a special JSON response with
 * `confirmation_required: true`. The server intercepts this, shows an approval
 * dialog to the user, and if approved, calls the specified execution tool on
 * the same MCP endpoint (phase 2).
 */

import type { ClientSession, EventEmitter } from '../agents/types';
import type { ToolApprovalRequestEvent } from '../types';
import { TOOL_APPROVAL_REQUEST } from '../types';
import { waitForApproval } from '../agents/toolApproval';
import type { RemoteMcpToolsProvider } from './RemoteMcpToolsProvider';
import type { McpHeadersMap } from '@meetsmore-oss/use-ai-core';
import { logger } from '../logger';

/**
 * Response shape returned by MCP tools that require user confirmation.
 * The server detects this via the `confirmation_required` sentinel field.
 */
export interface McpConfirmationResponse {
  /** Sentinel field — must be `true` */
  confirmation_required: true;
  /** Message shown in the approval dialog */
  message: string;
  /** Optional metadata passed through to the approval dialog */
  metadata?: Record<string, unknown>;
  /** Tool to call on the same MCP endpoint if the user approves */
  execute_on_approval: {
    /** MCP tool name (original, without namespace) */
    tool: string;
    /** Arguments to pass to the tool */
    args: Record<string, unknown>;
  };
}

/**
 * Type guard that checks whether a tool result is an MCP confirmation response.
 */
export function isMcpConfirmationResponse(
  value: unknown
): value is McpConfirmationResponse {
  if (value == null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.confirmation_required === true &&
    typeof obj.message === 'string' &&
    obj.execute_on_approval != null &&
    typeof obj.execute_on_approval === 'object' &&
    typeof (obj.execute_on_approval as Record<string, unknown>).tool === 'string' &&
    (obj.execute_on_approval as Record<string, unknown>).args != null &&
    typeof (obj.execute_on_approval as Record<string, unknown>).args === 'object'
  );
}

/**
 * Handles an MCP confirmation response:
 * 1. Emits TOOL_APPROVAL_REQUEST to the client
 * 2. Waits for user approval via waitForApproval()
 * 3. If approved → calls provider.executeTool() with execute_on_approval tool/args
 * 4. If rejected → returns error result
 *
 * Phase-2 results are returned as-is (no re-interception).
 */
export async function handleMcpConfirmation(
  confirmation: McpConfirmationResponse,
  toolCallId: string,
  toolCallName: string,
  provider: RemoteMcpToolsProvider,
  session: ClientSession,
  events: EventEmitter,
  mcpHeaders?: McpHeadersMap
): Promise<unknown> {
  logger.info('[MCP] Tool returned confirmation_required', {
    toolCallId,
    toolCallName,
    message: confirmation.message,
    phase2Tool: confirmation.execute_on_approval.tool,
  });

  // Emit approval request event to the client
  events.emit<ToolApprovalRequestEvent>({
    type: TOOL_APPROVAL_REQUEST,
    toolCallId,
    toolCallName,
    toolCallArgs: confirmation.execute_on_approval.args,
    message: confirmation.message,
    metadata: confirmation.metadata,
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

  logger.info('[MCP] Confirmation approved, executing phase 2', {
    toolCallId,
    phase2Tool: confirmation.execute_on_approval.tool,
  });

  // Phase 2: call the execution tool on the same MCP endpoint
  try {
    const result = await provider.executeTool(
      confirmation.execute_on_approval.tool,
      confirmation.execute_on_approval.args,
      mcpHeaders
    );
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[MCP] Phase 2 execution failed', {
      toolCallId,
      phase2Tool: confirmation.execute_on_approval.tool,
      error: errorMsg,
    });
    return {
      error: true,
      message: `MCP confirmation execution failed: ${errorMsg}`,
    };
  }
}
