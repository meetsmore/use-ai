import { useState, useCallback, useRef, useMemo } from 'react';
import type { ToolsDefinition } from '../defineTool';

export interface RegisterToolsOptions {
  /** Mark component as invisible (no visual state, skip prompt wait) */
  invisible?: boolean;
}

export interface UseToolRegistryReturn {
  /** Registers tools for a specific component */
  registerTools: (id: string, tools: ToolsDefinition, options?: RegisterToolsOptions) => void;
  /** Unregisters tools for a specific component */
  unregisterTools: (id: string) => void;
  /** Checks if a component is marked as invisible */
  isInvisible: (id: string) => boolean;
  /** All tools aggregated from registered components */
  aggregatedTools: ToolsDefinition;
  /** Whether any tools are registered */
  hasTools: boolean;
  /** Ref to current aggregated tools (for use in closures) */
  aggregatedToolsRef: React.MutableRefObject<ToolsDefinition>;
  /** Ref mapping tool names to component IDs */
  toolOwnershipRef: React.MutableRefObject<Map<string, string>>;
}

/**
 * Hook for managing tool registration and aggregation.
 *
 * Only handles tools - prompt management is handled separately.
 */
export function useToolRegistry(): UseToolRegistryReturn {
  const toolRegistryRef = useRef<Map<string, ToolsDefinition>>(new Map());
  const [toolRegistryVersion, setToolRegistryVersion] = useState(0);
  const toolOwnershipRef = useRef<Map<string, string>>(new Map());
  const invisibleRef = useRef<Set<string>>(new Set());

  const registerTools = useCallback((
    id: string,
    tools: ToolsDefinition,
    options?: RegisterToolsOptions
  ) => {
    const existingTools = toolRegistryRef.current.get(id);

    // Always update the ref to capture latest closures
    toolRegistryRef.current.set(id, tools);

    // Only increment version if tool names changed (added/removed tools)
    if (existingTools) {
      const existingKeys = Object.keys(existingTools).sort().join(',');
      const newKeys = Object.keys(tools).sort().join(',');
      if (existingKeys !== newKeys) {
        setToolRegistryVersion(v => v + 1);
      }
    } else {
      // First registration
      setToolRegistryVersion(v => v + 1);
    }

    Object.keys(tools).forEach(toolName => {
      toolOwnershipRef.current.set(toolName, id);
    });

    // Track invisible status
    if (options?.invisible) {
      invisibleRef.current.add(id);
    } else {
      invisibleRef.current.delete(id);
    }
  }, []);

  const unregisterTools = useCallback((id: string) => {
    const tools = toolRegistryRef.current.get(id);
    if (tools) {
      Object.keys(tools).forEach(toolName => {
        toolOwnershipRef.current.delete(toolName);
      });
    }

    toolRegistryRef.current.delete(id);
    setToolRegistryVersion(v => v + 1);
    invisibleRef.current.delete(id);
  }, []);

  const isInvisible = useCallback((id: string) => {
    return invisibleRef.current.has(id);
  }, []);

  const aggregatedTools = useMemo(() => {
    const tools: ToolsDefinition = {};
    toolRegistryRef.current.forEach((toolSet) => {
      Object.assign(tools, toolSet);
    });
    return tools;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolRegistryVersion]);

  const hasTools = toolRegistryRef.current.size > 0;

  // Keep a ref to aggregated tools for use in closures
  const aggregatedToolsRef = useRef(aggregatedTools);
  aggregatedToolsRef.current = aggregatedTools;

  return {
    registerTools,
    unregisterTools,
    isInvisible,
    aggregatedTools,
    hasTools,
    aggregatedToolsRef,
    toolOwnershipRef,
  };
}
