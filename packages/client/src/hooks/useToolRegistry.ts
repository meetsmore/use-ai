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
  /**
   * Signals that a component has completed its registration in useLayoutEffect.
   * Call this in useLayoutEffect after registerTools to indicate the component is ready.
   */
  signalReady: (id: string) => void;
  /**
   * Waits for tools to stabilize after a potential change.
   * Uses React lifecycle signaling for deterministic detection.
   * Components must call signalReady() in useLayoutEffect after registration.
   */
  waitForToolsToStabilize: () => Promise<void>;
  /** Current tool registry version (increments when tools change) */
  toolRegistryVersion: number;
}

/**
 * Hook for managing tool registration and aggregation.
 *
 * Uses a signaling pattern where:
 * 1. registerTools() marks a component as "pending"
 * 2. signalReady() (called in useLayoutEffect) marks it as "ready"
 * 3. waitForToolsToStabilize() waits until all components are ready
 *
 * This is more reliable than RAF-based waiting because it hooks directly
 * into React's commit lifecycle via useLayoutEffect.
 */
export function useToolRegistry(): UseToolRegistryReturn {
  const toolRegistryRef = useRef<Map<string, ToolsDefinition>>(new Map());
  const [toolRegistryVersion, setToolRegistryVersion] = useState(0);
  const toolOwnershipRef = useRef<Map<string, string>>(new Map());
  const invisibleRef = useRef<Set<string>>(new Set());

  // Ready state tracking for each component
  const readyStateRef = useRef<Map<string, boolean>>(new Map());

  // Callbacks to notify when ready state changes
  const readyListenersRef = useRef<Set<() => void>>(new Set());

  const registerTools = useCallback((
    id: string,
    tools: ToolsDefinition,
    options?: RegisterToolsOptions
  ) => {
    const existingTools = toolRegistryRef.current.get(id);

    // Always update the ref to capture latest closures
    toolRegistryRef.current.set(id, tools);

    // Mark as NOT ready - will be set ready by signalReady in useLayoutEffect
    readyStateRef.current.set(id, false);

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

  const signalReady = useCallback((id: string) => {
    // Only signal if the component is registered
    if (!toolRegistryRef.current.has(id)) {
      return;
    }

    readyStateRef.current.set(id, true);

    // Notify all listeners that ready state changed
    readyListenersRef.current.forEach(listener => listener());
  }, []);

  const unregisterTools = useCallback((id: string) => {
    const tools = toolRegistryRef.current.get(id);
    if (tools) {
      Object.keys(tools).forEach(toolName => {
        toolOwnershipRef.current.delete(toolName);
      });
    }

    toolRegistryRef.current.delete(id);
    readyStateRef.current.delete(id);
    setToolRegistryVersion(v => v + 1);
    invisibleRef.current.delete(id);

    // Notify listeners - removal might make everything ready
    readyListenersRef.current.forEach(listener => listener());
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

  /**
   * Waits for tools to stabilize using React lifecycle signaling.
   *
   * Strategy:
   * 1. Wait for the next macrotask to let React process pending state updates
   * 2. Wait for all registered components to signal ready
   * 3. Safety timeout to prevent infinite waiting
   *
   * The key insight is that registerTools marks components as "not ready",
   * and signalReady (called in useLayoutEffect) marks them as "ready".
   * So we just need to wait until all components are ready.
   */
  const waitForToolsToStabilize = useCallback(async (): Promise<void> => {
    const maxWaitMs = 500; // Safety timeout

    // Helper to check if all components are ready
    const checkAllReady = (): boolean => {
      if (readyStateRef.current.size === 0) return true;
      for (const ready of readyStateRef.current.values()) {
        if (!ready) return false;
      }
      return true;
    };

    // Wait for next macrotask to let React process pending state updates
    // (React batches updates and flushes them asynchronously)
    await new Promise(resolve => setTimeout(resolve, 0));

    // If all ready after React has had a chance to process, we're done
    if (checkAllReady()) {
      return;
    }

    // Wait for all components to signal ready
    return new Promise<void>((resolve) => {
      let safetyTimeout: ReturnType<typeof setTimeout> | null = null;
      let resolved = false;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        if (safetyTimeout) clearTimeout(safetyTimeout);
        readyListenersRef.current.delete(onReadyChange);
      };

      const onReadyChange = () => {
        if (resolved) return;
        if (checkAllReady()) {
          cleanup();
          resolve();
        }
      };

      // Safety timeout
      safetyTimeout = setTimeout(() => {
        cleanup();
        resolve();
      }, maxWaitMs);

      // Register listener
      readyListenersRef.current.add(onReadyChange);

      // Check immediately (in case all became ready between the check above and now)
      onReadyChange();
    });
  }, []);

  return {
    registerTools,
    unregisterTools,
    isInvisible,
    aggregatedTools,
    hasTools,
    aggregatedToolsRef,
    toolOwnershipRef,
    signalReady,
    waitForToolsToStabilize,
    toolRegistryVersion,
  };
}
