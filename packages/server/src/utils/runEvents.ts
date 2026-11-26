import { EventType, type RunErrorEvent, type RunStartedEvent } from '../types';

/**
 * Builds a RUN_ERROR event with the current time.
 *
 * @param message - The error message or `ErrorCode` that the client gets
 */
export function runError(message: string): RunErrorEvent {
  return {
    type: EventType.RUN_ERROR,
    message,
    timestamp: Date.now(),
  };
}

/**
 * Builds a RUN_STARTED event with the current time.
 * The event does not include the optional `input`, so the request is not sent back to the client.
 */
export function runStarted(threadId: string, runId: string): RunStartedEvent {
  return {
    type: EventType.RUN_STARTED,
    threadId,
    runId,
    timestamp: Date.now(),
  };
}
