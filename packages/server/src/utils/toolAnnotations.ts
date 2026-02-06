import { ToolAnnotations, ToolDefinition } from "@meetsmore-oss/use-ai-core";
import { isRemoteTool } from "./toolFilters";

/**
 * Gets annotations from a tool definition, handling both frontend and MCP tools.
 * For frontend tools, returns tool.annotations.
 * For MCP tools, returns tool._remote.annotations.
 *
 * @param tool - Tool definition to get annotations from
 * @returns Tool annotations or undefined if none exist
 *
 * @example
 * ```typescript
 * const annotations = getToolAnnotations(toolDef);
 * if (annotations?.destructiveHint) {
 *   // Tool requires confirmation
 * }
 * ```
 */
export function getToolAnnotations(tool: ToolDefinition | undefined | null): ToolAnnotations | undefined {
  // No tool == no annotations
  if (!tool) {
    return undefined
  }
  // Frontend tool annotations take precedence
  if (tool.annotations) {
    return tool.annotations;
  }
  // Check MCP tool annotations
  if (isRemoteTool(tool)) {
    return tool._remote.annotations;
  }
  return undefined;
}