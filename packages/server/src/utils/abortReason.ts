/**
 * Why a run's AbortController was triggered.
 *
 * `user_stop`         - the user explicitly cancelled the run (Stop button →
 *                       `abort_run` message).
 * `client_disconnect` - the socket dropped before the run finished (tab close,
 *                       network loss, idle disconnect).
 *
 * The two causes previously collapsed into a single unlabelled `abort()` call,
 * so downstream traces / logs could not tell an intentional Stop apart from a
 * passive disconnect. Carrying the cause on `signal.reason` restores that
 * distinction at its only source of truth.
 */
export type AbortReason = 'user_stop' | 'client_disconnect';

/**
 * Distinct, human-readable message per cause.
 *
 * These strings surface verbatim as the aborted tool span's status message
 * (AI SDK copies the thrown error's message onto the `ai.toolCall` span). The
 * meetsone span→log processor forwards `span.status.message` as-is and
 * delegates error categorization to Datadog Pipelines, so the cause becomes
 * queryable via the `error` field with no transcription-side change. Keep them
 * stable — Datadog facets/monitors match on them.
 */
const ABORT_MESSAGES: Record<AbortReason, string> = {
  user_stop: 'Run aborted by user',
  client_disconnect: 'Run aborted by client disconnect',
};

/**
 * Error used as the AbortController abort reason. Its message identifies the
 * cause so aborted tool calls can be told apart in traces and logs.
 */
export class RunAbortedError extends Error {
  readonly reason: AbortReason;

  constructor(reason: AbortReason) {
    super(ABORT_MESSAGES[reason]);
    this.name = 'RunAbortedError';
    this.reason = reason;
  }
}

/**
 * Aborts the controller, tagging the signal with the cause. No-op when the
 * controller is missing. When it is already aborted, the native `abort()` is
 * itself a no-op that keeps the first reason — so the first cause wins.
 *
 * @param controller - The run's AbortController (may be undefined).
 * @param reason - Why the run is being aborted.
 */
export function abortRun(
  controller: AbortController | undefined,
  reason: AbortReason,
): void {
  if (!controller) return;
  controller.abort(new RunAbortedError(reason));
}

/**
 * Resolves the rejection error for a tool call/approval interrupted by an
 * abort. Returns the cause recorded on the signal (a {@link RunAbortedError}),
 * or a generic error when the signal was aborted without one (e.g. `abort()`
 * called directly, or a non-RunAbortedError reason).
 *
 * @param signal - The run's abort signal (may be undefined).
 * @returns The cause-carrying error, or a generic `'Run aborted'` error.
 */
export function createAbortError(signal: AbortSignal | undefined): Error {
  const cause = signal?.reason;
  return cause instanceof RunAbortedError ? cause : new Error('Run aborted');
}

/**
 * The status message to stamp on an aborted span, resolved from the signal's
 * cause. Centralizes the cause strings so the aborted tool span and the
 * run-level span stay in sync (Datadog facets / Langfuse traces read these —
 * see {@link ABORT_MESSAGES}).
 *
 * @param signal - The run's abort signal (may be undefined).
 * @returns The cause-specific message, or a generic `'Run aborted'`.
 */
export function abortReasonMessage(signal: AbortSignal | undefined): string {
  const cause = signal?.reason;
  return cause instanceof RunAbortedError ? cause.message : 'Run aborted';
}
