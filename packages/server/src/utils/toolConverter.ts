import type { ClientSession } from '../agents/types';
import { createAbortError } from './abortReason';

/**
 * Generic tool arguments type - tools receive key-value pairs
 */
type ToolArguments = Record<string, unknown>;

/**
 * Generic tool result type - tools can return any value
 */
type ToolResult = unknown;

/**
 * Creates execute function for client-side tools.
 * Note: TOOL_CALL events are emitted from the stream loop, not here.
 * The toolCallId is provided by AI SDK in the execute options.
 *
 * @param session - The client session containing pendingToolCalls map
 * @returns An async function that waits for client tool execution and returns the result
 */
export function createClientToolExecutor(
  session: ClientSession
): (args: ToolArguments, options: { toolCallId: string }) => Promise<ToolResult> {
  return async (args: ToolArguments, { toolCallId }): Promise<ToolResult> => {
    // Wait for client to send result (async - can take as long as needed)
    const result = await new Promise<string>((resolve, reject) => {
      const signal = session.abortController?.signal;
      // Check if already aborted (e.g., client disconnected before tool call started)
      if (signal?.aborted) {
        reject(createAbortError(signal));
        return;
      }

      session.pendingToolCalls.set(toolCallId, resolve);

      // Listen for abort signal to reject the promise (client disconnect or explicit abort)
      signal?.addEventListener('abort', () => {
        session.pendingToolCalls.delete(toolCallId);
        reject(createAbortError(signal));
      }, { once: true });
    });

    return JSON.parse(result);
  };
}
