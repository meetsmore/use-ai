/**
 * Base for run-abort causes. The concrete class `name` (e.g. `RunAbortedByUser`)
 * is the stable field monitoring matches on — keep names stable; `message` is
 * for humans, not for matching.
 */
export abstract class RunAbortedError extends Error {}

/** The user explicitly stopped the run (Stop button → `abort_run` message). */
export class RunAbortedByUser extends RunAbortedError {
  constructor() {
    super('Run aborted by user');
    this.name = 'RunAbortedByUser';
  }
}

/** The client socket dropped before the run finished. */
export class RunAbortedByClientDisconnect extends RunAbortedError {
  constructor() {
    super('Run aborted by client disconnect');
    this.name = 'RunAbortedByClientDisconnect';
  }
}

/**
 * Aborts the controller, tagging the signal with the cause. No-op when the
 * controller is missing. When it is already aborted, the native `abort()` is
 * itself a no-op that keeps the first reason — so the first cause wins.
 *
 * @param controller - The run's AbortController (may be undefined).
 * @param error - The cause, e.g. `new RunAbortedByUser()`.
 */
export function abortRun(
  controller: AbortController | undefined,
  error: RunAbortedError,
): void {
  if (!controller) return;
  controller.abort(error);
}

/**
 * Resolves the rejection error for a tool call/approval interrupted by an
 * abort. Returns the cause recorded on the signal (a {@link RunAbortedError}),
 * or a generic error when the signal was aborted without one (e.g. `abort()`
 * called directly).
 *
 * @param signal - The run's abort signal (may be undefined).
 * @returns The cause-carrying error, or a generic `'Run aborted'` error.
 */
export function createAbortError(signal: AbortSignal | undefined): Error {
  const cause = signal?.reason;
  return cause instanceof RunAbortedError ? cause : new Error('Run aborted');
}

/**
 * Human message for an aborted span, from the signal's cause. For matching, use
 * the error `name` (see {@link RunAbortedError}), not this.
 *
 * @param signal - The run's abort signal (may be undefined).
 * @returns The cause-specific message, or a generic `'Run aborted'`.
 */
export function abortReasonMessage(signal: AbortSignal | undefined): string {
  const cause = signal?.reason;
  return cause instanceof RunAbortedError ? cause.message : 'Run aborted';
}
