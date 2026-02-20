import { useState, useCallback, useRef, useMemo, type RefObject, type MutableRefObject } from 'react';
import type { ToolAnnotations, ToolApprovalRequestEvent } from '../types';
import type { UseAIClient } from '../client';
import type { ToolsDefinition } from '../defineTool';
import { executeDefinedTool } from '../defineTool';

// ── Registry Types ──────────────────────────────────────────────────────────

export interface RegisterToolsOptions {
  /** Mark component as invisible (no visual state, skip prompt wait) */
  invisible?: boolean;
}

// ── Execution Types ─────────────────────────────────────────────────────────

/**
 * Pending tool approval request state.
 */
export interface PendingToolApproval {
  toolCallId: string;
  toolCallName: string;
  toolCallArgs: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

// ── Hook Options & Return ───────────────────────────────────────────────────

export interface UseToolSystemOptions {
  /** Reference to the UseAI client for sending responses */
  clientRef: RefObject<UseAIClient | null>;
  /** Builds the aggregated state from all registered prompts */
  buildState: () => unknown;
}

export interface UseToolSystemReturn {
  // ── Registry ──────────────────────────────────────────────────────────────

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
  aggregatedToolsRef: MutableRefObject<ToolsDefinition>;
  /** Signals that a component has completed its registration in useLayoutEffect */
  signalReady: (id: string) => void;
  /** Current tool registry version (increments when tools change) */
  toolRegistryVersion: number;

  // ── Waiters ───────────────────────────────────────────────────────────────

  /** Registers a waiter function for a component (called when tool exec needs to wait for re-render) */
  registerWaiter: (id: string, waiter: () => Promise<void>) => void;
  /** Unregisters a waiter function */
  unregisterWaiter: (id: string) => void;

  // ── Execution ─────────────────────────────────────────────────────────────

  /** All pending tool approval requests */
  pendingApprovals: PendingToolApproval[];
  /** Handle a tool approval request event from the server */
  handleApprovalRequest: (event: ToolApprovalRequestEvent) => void;
  /** Execute a tool call and send the response to the server */
  executeToolCall: (toolCallId: string, name: string, input: unknown) => Promise<void>;
  /** Store a tool call as pending approval (deferred execution) */
  storePendingToolCall: (toolCallId: string, name: string, input: unknown, toolCallData: { name: string; args: string }) => void;
  /** Approve all pending tool calls and execute them */
  approveAll: () => Promise<void>;
  /** Reject all pending tool calls with optional reason */
  rejectAll: (reason?: string) => void;
}

/**
 * Unified hook for the tool lifecycle: registration, waiter coordination,
 * and execution (including approval flow).
 *
 * Merges what were previously three separate concerns:
 * - Tool registry (registration, aggregation, ownership tracking)
 * - Waiters (waiting for component re-renders after tool execution)
 * - Tool execution (running tools, sending responses, approval flow)
 *
 * The only external dependency is `buildState` from prompt management,
 * which provides the aggregated app state sent alongside tool responses.
 */
export function useToolSystem({
  clientRef,
  buildState,
}: UseToolSystemOptions): UseToolSystemReturn {

  // ── Registry State ──────────────────────────────────────────────────────

  const toolRegistryRef = useRef<Map<string, ToolsDefinition>>(new Map());
  const [toolRegistryVersion, setToolRegistryVersion] = useState(0);
  const toolOwnershipRef = useRef<Map<string, string>>(new Map());
  const invisibleRef = useRef<Set<string>>(new Set());

  // Ready state tracking for each component
  const readyStateRef = useRef<Map<string, boolean>>(new Map());
  const readyListenersRef = useRef<Set<() => void>>(new Set());

  // ── Waiter State ────────────────────────────────────────────────────────

  const waitersRef = useRef<Map<string, () => Promise<void>>>(new Map());

  // ── Execution State ─────────────────────────────────────────────────────

  const [pendingApprovals, setPendingApprovals] = useState<PendingToolApproval[]>([]);
  const pendingApprovalToolCallsRef = useRef<Map<string, { name: string; input: unknown; toolCallData: { name: string; args: string } }>>(new Map());

  // ── Registry Methods ────────────────────────────────────────────────────

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
      setToolRegistryVersion(v => v + 1);
    }

    Object.keys(tools).forEach(toolName => {
      toolOwnershipRef.current.set(toolName, id);
    });

    if (options?.invisible) {
      invisibleRef.current.add(id);
    } else {
      invisibleRef.current.delete(id);
    }
  }, []);

  const signalReady = useCallback((id: string) => {
    if (!toolRegistryRef.current.has(id)) {
      return;
    }
    readyStateRef.current.set(id, true);
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

  const aggregatedToolsRef = useRef(aggregatedTools);
  aggregatedToolsRef.current = aggregatedTools;

  /**
   * Waits for tools to stabilize using React lifecycle signaling.
   *
   * Strategy:
   * 1. Wait for the next macrotask to let React process pending state updates
   * 2. Wait for all registered components to signal ready
   * 3. Safety timeout to prevent infinite waiting
   */
  const waitForToolsToStabilize = useCallback(async (): Promise<void> => {
    const maxWaitMs = 500;

    const checkAllReady = (): boolean => {
      if (readyStateRef.current.size === 0) return true;
      for (const ready of readyStateRef.current.values()) {
        if (!ready) return false;
      }
      return true;
    };

    await new Promise(resolve => setTimeout(resolve, 0));

    if (checkAllReady()) {
      return;
    }

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

      safetyTimeout = setTimeout(() => {
        cleanup();
        resolve();
      }, maxWaitMs);

      readyListenersRef.current.add(onReadyChange);
      onReadyChange();
    });
  }, []);

  // ── Waiter Methods ──────────────────────────────────────────────────────

  const registerWaiter = useCallback((id: string, waiter: () => Promise<void>) => {
    waitersRef.current.set(id, waiter);
  }, []);

  const unregisterWaiter = useCallback((id: string) => {
    waitersRef.current.delete(id);
  }, []);

  const getWaiter = useCallback((id: string) => {
    return waitersRef.current.get(id);
  }, []);

  // ── Execution Methods ───────────────────────────────────────────────────

  const handleApprovalRequest = useCallback((event: ToolApprovalRequestEvent) => {
    console.log('[useToolSystem] Tool approval requested:', event.toolCallName, event.toolCallId);
    setPendingApprovals(prev => [
      ...prev,
      {
        toolCallId: event.toolCallId,
        toolCallName: event.toolCallName,
        toolCallArgs: event.toolCallArgs,
        annotations: event.annotations,
      },
    ]);
  }, []);

  const executeToolCall = useCallback(async (
    toolCallId: string,
    name: string,
    input: unknown
  ) => {
    const client = clientRef.current;
    if (!client) {
      console.error('[useToolSystem] No client available for tool execution');
      return;
    }

    try {
      const ownerId = toolOwnershipRef.current.get(name);
      console.log(`[useToolSystem] Tool "${name}" owned by component:`, ownerId);

      console.log('[useToolSystem] Executing tool...');
      const result = await executeDefinedTool(aggregatedToolsRef.current, name, input);

      const isErrorResult = result && typeof result === 'object' &&
        ('error' in result || (result as Record<string, unknown>).success === false);

      const ownerIsInvisible = ownerId ? isInvisible(ownerId) : false;

      // Wait for prompt to update (via waiter registered by useAI) unless it's an error or invisible
      if (ownerId && !isErrorResult && !ownerIsInvisible) {
        const waiter = getWaiter(ownerId);
        if (waiter) {
          console.log(`[useToolSystem] Waiting for prompt change from ${ownerId}...`);
          await waiter();
          console.log('[useToolSystem] Prompt change wait complete');
        }
      } else if (isErrorResult) {
        console.log('[useToolSystem] Tool returned error, skipping prompt wait');
      } else if (ownerIsInvisible) {
        console.log('[useToolSystem] Component is invisible, skipping prompt wait');
      }

      // Wait for tools to stabilize after execution (navigation/mount-unmount)
      console.log('[useToolSystem] Waiting for tools to stabilize...');
      await waitForToolsToStabilize();
      console.log('[useToolSystem] Tools stabilized');

      const updatedState = buildState();
      console.log(`[useToolSystem] Updated state (aggregated from all hooks)`);

      client.sendToolResponse(toolCallId, result, updatedState);
    } catch (err) {
      console.error('Tool execution error:', err);
      client.sendToolResponse(toolCallId, {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [clientRef, isInvisible, getWaiter, waitForToolsToStabilize, buildState]);

  const storePendingToolCall = useCallback((
    toolCallId: string,
    name: string,
    input: unknown,
    toolCallData: { name: string; args: string }
  ) => {
    console.log(`[useToolSystem] Storing pending tool call "${name}" for approval`);
    pendingApprovalToolCallsRef.current.set(toolCallId, { name, input, toolCallData });
  }, []);

  const executePendingToolAfterApproval = useCallback(async (toolCallId: string) => {
    const pendingTool = pendingApprovalToolCallsRef.current.get(toolCallId);
    if (!pendingTool) {
      console.warn(`[useToolSystem] No pending tool found for ${toolCallId}`);
      return;
    }

    pendingApprovalToolCallsRef.current.delete(toolCallId);
    await executeToolCall(toolCallId, pendingTool.name, pendingTool.input);
  }, [executeToolCall]);

  const approveAll = useCallback(async () => {
    if (!clientRef.current) return;
    console.log('[useToolSystem] Approving all tool calls:', pendingApprovals.length);

    const pendingTools = [...pendingApprovals];

    for (const pending of pendingTools) {
      clientRef.current.sendToolApprovalResponse(pending.toolCallId, true);
    }

    setPendingApprovals([]);

    for (const tool of pendingTools) {
      await executePendingToolAfterApproval(tool.toolCallId);
    }
  }, [clientRef, pendingApprovals, executePendingToolAfterApproval]);

  const rejectAll = useCallback((reason?: string) => {
    if (!clientRef.current) return;
    console.log('[useToolSystem] Rejecting all tool calls:', pendingApprovals.length, reason);

    const pendingTools = [...pendingApprovals];

    for (const pending of pendingTools) {
      clientRef.current.sendToolApprovalResponse(pending.toolCallId, false, reason);
    }

    setPendingApprovals([]);

    for (const tool of pendingTools) {
      pendingApprovalToolCallsRef.current.delete(tool.toolCallId);
    }
  }, [clientRef, pendingApprovals]);

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    // Registry
    registerTools,
    unregisterTools,
    isInvisible,
    aggregatedTools,
    hasTools,
    aggregatedToolsRef,
    signalReady,
    toolRegistryVersion,

    // Waiters
    registerWaiter,
    unregisterWaiter,

    // Execution
    pendingApprovals,
    handleApprovalRequest,
    executeToolCall,
    storePendingToolCall,
    approveAll,
    rejectAll,
  };
}
