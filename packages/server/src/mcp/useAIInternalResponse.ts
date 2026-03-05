/**
 * Base type and type guard for `_use_ai_` internal responses from MCP tools.
 *
 * MCP tools can return a JSON object with `_use_ai_internal: true` to signal
 * that the response requires special server-side handling (e.g. user approval).
 * The `_use_ai_type` discriminator determines the specific behavior.
 *
 * This module provides the base plumbing; concrete types (e.g.
 * `McpConfirmationResponse`) extend the base and are handled by dedicated
 * modules.
 */

/**
 * Base shape shared by all `_use_ai_` internal responses.
 */
export interface UseAIInternalResponse {
  /** Sentinel — must be `true` */
  _use_ai_internal: true;
  /** Discriminator — determines how the server handles this response */
  _use_ai_type: string;
  /** Type-specific payload */
  _use_ai_metadata: Record<string, unknown>;
}

/**
 * Type guard that checks whether a value is a `_use_ai_` internal response.
 *
 * Validates only the envelope (`_use_ai_internal`, `_use_ai_type`,
 * `_use_ai_metadata`).  Callers should further narrow via `_use_ai_type`.
 */
export function isUseAIInternalResponse(
  value: unknown
): value is UseAIInternalResponse {
  if (value == null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    obj._use_ai_internal === true &&
    typeof obj._use_ai_type === 'string' &&
    obj._use_ai_metadata != null &&
    typeof obj._use_ai_metadata === 'object'
  );
}
