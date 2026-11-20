/**
 * use-ai extension: the run that a server event belongs to.
 *
 * One connection can carry more than one run at a time, for example a chat run
 * and a workflow run. Most AG-UI events (text, tool calls, steps) do not name
 * their run, so the server adds this field to every event that a run emits.
 * The client uses it to give each event only to the run that started it.
 *
 * This is a separate field because `RunFinishedEvent.runId` can carry the
 * Langfuse trace id in place of the run id.
 */
export interface EventRunScope {
  /** The `runId` of the `run_agent` or `run_workflow` message that started the run. */
  useAIRunId?: string;
}

/**
 * Gets the run that an event belongs to.
 *
 * @returns The run id that the server put on the event, or `undefined` when the event has none
 */
export function getEventRunId(event: object): string | undefined {
  const runId = (event as EventRunScope).useAIRunId;
  return typeof runId === 'string' ? runId : undefined;
}

/**
 * Returns a copy of `event` that names the run it belongs to.
 * The server calls this for every event that a run emits.
 */
export function withEventRunId<T extends object>(event: T, runId: string): T & EventRunScope {
  return { ...event, useAIRunId: runId };
}
