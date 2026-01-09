import type { ClientSession } from '../agents/types';

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
    const result = await new Promise<string>((resolve) => {
      session.pendingToolCalls.set(toolCallId, resolve);
    });

    return JSON.parse(result);
  };
}
