/**
 * Shared `_use_ai_` internal response types.
 *
 * MCP tools can return these sentinel objects to request special handling from
 * the use-ai server. Only explicitly supported combinations of
 * `_use_ai_type` and `_use_ai_metadata` are accepted.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Base shape shared by all `_use_ai_` internal responses.
 */
export interface UseAIInternalResponseBase {
  /** Sentinel — must be `true` */
  _use_ai_internal: true;
  /** Discriminator — determines how the server handles this response */
  _use_ai_type: string;
  /** Type-specific payload */
  _use_ai_metadata: Record<string, unknown>;
}

/**
 * MCP runtime approval response.
 *
 * When returned from an MCP tool, the server should ask the user for approval.
 * If approved, the same tool is re-executed with `additional_columns` merged
 * into the original arguments.
 */
export interface McpConfirmationResponse extends UseAIInternalResponseBase {
  _use_ai_type: 'confirmation_required';
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
 * Union of all supported `_use_ai_` internal responses.
 *
 * Add new variants here as new internal response types are introduced.
 */
export type UseAIInternalResponse = McpConfirmationResponse;

/**
 * Type guard for the confirmation-required internal response.
 */
export function isMcpConfirmationResponse(
  value: unknown
): value is McpConfirmationResponse {
  const obj = asRecord(value);
  const metadata = obj ? asRecord(obj._use_ai_metadata) : null;

  return !!(
    obj &&
    obj._use_ai_internal === true &&
    obj._use_ai_type === 'confirmation_required' &&
    metadata &&
    typeof metadata.message === 'string'
  );
}

/**
 * Type guard that checks whether a value is a supported `_use_ai_` internal
 * response.
 */
export function isUseAIInternalResponse(
  value: unknown
): value is UseAIInternalResponse {
  return isMcpConfirmationResponse(value);
}
