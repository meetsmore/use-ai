import { useState, useCallback, useRef, useMemo, type RefObject, type MutableRefObject } from 'react';
import type { ToolAnnotations, ToolApprovalRequestEvent } from '../types';
import type { UseAIClient } from '../client';
import type { ToolsDefinition, ToolExecutionContext } from '../defineTool';
import { executeDefinedTool } from '../defineTool';
import { isErrorResult } from '../utils/toolCalls';

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
  /** Optional message explaining why approval is needed (runtime approval) */
  message?: string;
  /** Optional metadata for the approval request (runtime approval) */
  metadata?: Record<string, unknown>;
  /** True when edited arguments sent with an approval of this request are applied */
  acceptsModifiedArgs?: boolean;
}

/** Edited tool arguments, keyed by the toolCallId of the pending approval. */
export type ModifiedToolArgs = Record<string, Record<string, unknown>>;

/**
 * Whether a pending approval belongs to a tool call: the call's own approval
 * (`destructiveHint`, keyed by its `toolCallId`), or one the tool asked for
 * with `ctx.requestApproval`, keyed `${toolCallId}-runtime-${timestamp}`.
 */
export function isApprovalForToolCall(approval: PendingToolApproval, toolCallId: string): boolean {
  return approval.toolCallId === toolCallId || approval.toolCallId.startsWith(`${toolCallId}-runtime-`);
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
  /**
   * Approve all pending tool calls. A call whose toolCallId is a key of
   * `modifiedArgs` runs with those arguments instead of the AI's. Rejects, and
   * approves nothing, when a key names an approval without `acceptsModifiedArgs`.
   */
  approveWithArgs: (modifiedArgs: ModifiedToolArgs) => Promise<void>;
  /** Reject all pending tool calls with optional reason */
  rejectAll: (reason?: string) => void;
  /**
   * Called when a run ends, however it ends. Aborts the `ctx.signal` handed to
   * the run's tool calls and starts a fresh one for the next run. Also drops
   * the approvals still waiting for the user: a tool approved after its run
   * ended would act with nobody left to receive its result, and a tool
   * waiting in `ctx.requestApproval` gets `{ approved: false }`.
   */
  endRun: () => void;
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

  /** Resolvers for runtime approval requests (from ctx.requestApproval) */
  const runtimeApprovalResolversRef = useRef<Map<string, (result: { approved: boolean; reason?: string }) => void>>(new Map());

  /** One controller per run: every tool call of the run gets its signal as `ctx.signal`. */
  const runAbortControllerRef = useRef(new AbortController());

  const endRun = useCallback(() => {
    runAbortControllerRef.current.abort();
    runAbortControllerRef.current = new AbortController();

    // The server waits for an approval without ending the run, so approvals
    // are still pending here only when the run did not finish normally:
    // stopped, failed, disconnected or the provider was torn down.
    pendingApprovalToolCallsRef.current.clear();
    const resolvers = [...runtimeApprovalResolversRef.current.values()];
    runtimeApprovalResolversRef.current.clear();
    for (const resolve of resolvers) {
      resolve({ approved: false, reason: 'The run ended before the user answered' });
    }
    setPendingApprovals(prev => (prev.length > 0 ? [] : prev));
  }, []);

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
        message: event.message,
        metadata: event.metadata,
        acceptsModifiedArgs: event.acceptsModifiedArgs,
      },
    ]);
  }, []);

  const executeToolCall = useCallback(async (
    toolCallId: string,
    name: string,
    input: unknown
  ) => {
    const signal = runAbortControllerRef.current.signal;
    const client = clientRef.current;
    if (!client) {
      console.error('[useToolSystem] No client available for tool execution');
      return;
    }

    try {
      const ownerId = toolOwnershipRef.current.get(name);
      console.log(`[useToolSystem] Tool "${name}" owned by component:`, ownerId);

      // Build ToolExecutionContext with requestApproval for runtime approvals
      const ctx: ToolExecutionContext = {
        toolCallId,
        signal,
        requestApproval: ({ message, metadata }) => {
          return new Promise<{ approved: boolean; reason?: string }>((resolve) => {
            const approvalId = `${toolCallId}-runtime-${Date.now()}`;
            runtimeApprovalResolversRef.current.set(approvalId, resolve);

            setPendingApprovals(prev => [
              ...prev,
              {
                toolCallId: approvalId,
                toolCallName: name,
                toolCallArgs: (input as Record<string, unknown>) || {},
                message,
                metadata,
              },
            ]);
          });
        },
      };

      console.log('[useToolSystem] Executing tool...');
      const result = await executeDefinedTool(aggregatedToolsRef.current, name, input, ctx);
      // The run ended while the tool worked (e.g. a question gave up waiting on
      // `ctx.signal`). Nothing is left to receive the result, so skip waiting
      // for the prompt to update as well.
      if (signal.aborted) return;

      const isError = isErrorResult(result);

      const ownerIsInvisible = ownerId ? isInvisible(ownerId) : false;

      // Wait for prompt to update (via waiter registered by useAI) unless it's an error or invisible
      if (ownerId && !isError && !ownerIsInvisible) {
        const waiter = getWaiter(ownerId);
        if (waiter) {
          console.log(`[useToolSystem] Waiting for prompt change from ${ownerId}...`);
          await waiter();
          console.log('[useToolSystem] Prompt change wait complete');
        }
      } else if (isError) {
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

      // The run may also have ended during the waits above.
      if (signal.aborted) return;
      client.sendToolResponse(toolCallId, result, updatedState);
    } catch (err) {
      console.error('Tool execution error:', err);
      if (signal.aborted) return;
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

  const executePendingToolAfterApproval = useCallback(async (
    toolCallId: string,
    modifiedArgs?: Record<string, unknown>
  ) => {
    const pendingTool = pendingApprovalToolCallsRef.current.get(toolCallId);
    if (!pendingTool) {
      console.warn(`[useToolSystem] No pending tool found for ${toolCallId}`);
      return;
    }

    pendingApprovalToolCallsRef.current.delete(toolCallId);
    await executeToolCall(toolCallId, pendingTool.name, modifiedArgs ?? pendingTool.input);
  }, [executeToolCall]);

  const approve = useCallback(async (modifiedArgsByToolCallId?: ModifiedToolArgs) => {
    if (!clientRef.current) return;
    for (const toolCallId of Object.keys(modifiedArgsByToolCallId ?? {})) {
      const pending = pendingApprovals.find(approval => approval.toolCallId === toolCallId);
      if (!pending?.acceptsModifiedArgs) {
        throw new Error(`[useToolSystem] Approval ${toolCallId} does not accept edited arguments`);
      }
    }
    console.log('[useToolSystem] Approving all tool calls:', pendingApprovals.length);

    const pendingTools = [...pendingApprovals];
    setPendingApprovals([]);
    const runSignal = runAbortControllerRef.current.signal;

    for (const pending of pendingTools) {
      // The run ended while an earlier approved tool ran: endRun dropped the
      // rest, so approving them would answer a run that is over.
      if (runSignal.aborted) break;
      // Check if this is a runtime client-side approval (from ctx.requestApproval)
      const runtimeResolver = runtimeApprovalResolversRef.current.get(pending.toolCallId);
      if (runtimeResolver) {
        runtimeApprovalResolversRef.current.delete(pending.toolCallId);
        runtimeResolver({ approved: true });
      } else {
        // Server-side approval (destructiveHint flow)
        const modifiedArgs = modifiedArgsByToolCallId?.[pending.toolCallId];
        clientRef.current.sendToolApprovalResponse(pending.toolCallId, true, undefined, modifiedArgs);
        await executePendingToolAfterApproval(pending.toolCallId, modifiedArgs);
      }
    }
  }, [clientRef, pendingApprovals, executePendingToolAfterApproval]);

  const approveAll = useCallback(() => approve(), [approve]);
  const approveWithArgs = useCallback(
    (modifiedArgs: ModifiedToolArgs) => approve(modifiedArgs),
    [approve]
  );

  const rejectAll = useCallback((reason?: string) => {
    if (!clientRef.current) return;
    console.log('[useToolSystem] Rejecting all tool calls:', pendingApprovals.length, reason);

    const pendingTools = [...pendingApprovals];
    setPendingApprovals([]);

    for (const pending of pendingTools) {
      // Check if this is a runtime client-side approval (from ctx.requestApproval)
      const runtimeResolver = runtimeApprovalResolversRef.current.get(pending.toolCallId);
      if (runtimeResolver) {
        runtimeApprovalResolversRef.current.delete(pending.toolCallId);
        runtimeResolver({ approved: false, reason });
      } else {
        // Server-side approval (destructiveHint flow)
        clientRef.current.sendToolApprovalResponse(pending.toolCallId, false, reason);
        pendingApprovalToolCallsRef.current.delete(pending.toolCallId);
      }
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
    approveWithArgs,
    rejectAll,
    endRun,
  };
}
