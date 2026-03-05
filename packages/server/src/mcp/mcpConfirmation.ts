/**
 * MCP tool runtime interactive approval.
 *
 * MCP tools that need user confirmation return a special JSON response with
 * `_use_ai_internal: true` and `_use_ai_type: "confirmation_required"`.
 * The server intercepts this, shows an approval dialog to the user, and if
 * approved, re-calls the same tool with original args merged with
 * `additional_columns` (phase 2).
 *
 * The `_use_ai_` prefix avoids namespace collisions with user data.
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
 * Uses `_use_ai_` prefix to avoid collisions with user data fields.
 */
export interface McpConfirmationResponse {
  /** Sentinel — must be `true` */
  _use_ai_internal: true;
  /** Type discriminator */
  _use_ai_type: 'confirmation_required';
  /** Payload */
  _use_ai_metadata: {
    /** Message shown in the approval dialog */
    message: string;
    /** Optional metadata passed through to the approval dialog */
    metadata?: Record<string, unknown>;
    /** Optional extra columns merged into original args for phase 2 */
    additional_columns?: Record<string, unknown>;
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
  if (obj._use_ai_internal !== true) return false;
  if (obj._use_ai_type !== 'confirmation_required') return false;
  const meta = obj._use_ai_metadata;
  if (meta == null || typeof meta !== 'object') return false;
  return typeof (meta as Record<string, unknown>).message === 'string';
}

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
