import { useRef } from 'react';
import type { ToolsDefinition, DefinedTool } from '../defineTool';
import type { z } from 'zod';

/**
 * Creates stable tool references that maintain fresh closures.
 *
 * This hook solves the "render loop" problem that occurs when users define tools
 * inline without memoization. It ensures that:
 *
 * 1. Tool object references remain stable as long as tool names don't change
 * 2. Handler calls are proxied through refs to always use the latest closure
 * 3. Metadata (description, schema, confirmationRequired) updates in-place
 *
 * @param tools - The tools definition from the user (potentially unstable references)
 * @returns Stabilized tools definition that won't cause effect re-runs
 *
 * @example
 * ```typescript
 * // Previously problematic - caused render loops
 * useAI({
 *   tools: {
 *     updateState: defineTool('Update state', z.object({ value: z.string() }),
 *       (input) => setState(input.value)  // Closure recreated every render
 *     ),
 *   },
 * });
 *
 * // Now works correctly - useStableTools handles stabilization internally
 * ```
 */
export function useStableTools(tools: ToolsDefinition | undefined): ToolsDefinition | undefined {
  // Ref to store latest tools (updated every render for fresh closures)
  const latestToolsRef = useRef<ToolsDefinition>({});

  // Ref to store stable wrapper objects
  const stableToolsRef = useRef<ToolsDefinition>({});

  // Track tool names for change detection
  const prevToolNamesRef = useRef<string>('');

  if (!tools) {
    latestToolsRef.current = {};
    return undefined;
  }

  // Always update latest ref (for fresh closures)
  latestToolsRef.current = tools;

  const currentToolNames = Object.keys(tools).sort().join(',');

  if (currentToolNames !== prevToolNamesRef.current) {
    // Tool names changed - rebuild stable wrappers
    prevToolNamesRef.current = currentToolNames;
    stableToolsRef.current = {};

    for (const [name, tool] of Object.entries(tools)) {
      stableToolsRef.current[name] = createStableToolWrapper(
        name,
        tool,
        latestToolsRef
      );
    }
  } else {
    // Tool names unchanged - update metadata in-place without creating new objects
    for (const [name, tool] of Object.entries(tools)) {
      const stable = stableToolsRef.current[name];
      if (stable) {
        stable.description = tool.description;
        stable._jsonSchema = tool._jsonSchema;
        stable._zodSchema = tool._zodSchema;
        stable._options = tool._options;
      }
    }
  }

  return stableToolsRef.current;
}

/**
 * Creates a stable wrapper for a tool that proxies handler calls through refs.
 *
 * The wrapper has a stable identity but always calls the latest handler.
 */
function createStableToolWrapper(
  name: string,
  tool: DefinedTool<z.ZodType>,
  latestToolsRef: React.MutableRefObject<ToolsDefinition>
): DefinedTool<z.ZodType> {
  // Create a stable handler that proxies to the latest version
  const stableHandler = (input: unknown) => {
    const currentTool = latestToolsRef.current[name];
    if (!currentTool) {
      throw new Error(`Tool "${name}" no longer exists`);
    }
    return currentTool.fn(input);
  };

  // Create the stable _execute function
  const stableExecute = async (input: unknown) => {
    const currentTool = latestToolsRef.current[name];
    if (!currentTool) {
      throw new Error(`Tool "${name}" no longer exists`);
    }
    return await currentTool._execute(input);
  };

  return {
    description: tool.description,
    _jsonSchema: tool._jsonSchema,
    _zodSchema: tool._zodSchema,
    fn: stableHandler,
    _options: tool._options,
    _toToolDefinition: tool._toToolDefinition.bind(tool),
    _execute: stableExecute,
  };
}
