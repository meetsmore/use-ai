import { useState, useCallback, useRef, type RefObject, type MutableRefObject } from 'react';
import type { ToolAnnotations, ToolApprovalRequestEvent } from '../types';
import type { UseAIClient } from '../client';
import type { ToolsDefinition } from '../defineTool';
import { executeDefinedTool } from '../defineTool';

/**
 * Pending tool approval request state.
 */
export interface PendingToolApproval {
  toolCallId: string;
  toolCallName: string;
  toolCallArgs: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

/**
 * Options for the useToolExecution hook.
 */
export interface UseToolExecutionOptions {
  /** Reference to the UseAI client for sending responses */
  clientRef: RefObject<UseAIClient | null>;
  /** Reference to aggregated tools from all useAI hooks */
  aggregatedToolsRef: MutableRefObject<ToolsDefinition>;
  /** Reference to tool ownership map (tool name -> owner component id) */
  toolOwnershipRef: MutableRefObject<Map<string, string>>;
  /** Reference to prompts map (component id -> prompt string) */
  promptsRef: MutableRefObject<Map<string, string>>;
  /** Function to check if a component is invisible */
  isInvisible: (componentId: string) => boolean;
  /** Function to get a waiter for a component */
  getWaiter: (componentId: string) => (() => Promise<void>) | undefined;
  /** Function to wait for tools to stabilize after execution (e.g., after navigation) */
  waitForToolsToStabilize: () => Promise<void>;
}

/**
 * Return value of the useToolExecution hook.
 */
export interface UseToolExecutionResult {
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
 * Hook for managing tool execution and confirmation flow.
 * Handles:
 * - Tool execution with state synchronization
 * - Pending approval state for tools requiring confirmation
 * - Batch approve/reject for multiple tool calls
 */
export function useToolExecution({
  clientRef,
  aggregatedToolsRef,
  toolOwnershipRef,
  promptsRef,
  isInvisible,
  getWaiter,
  waitForToolsToStabilize,
}: UseToolExecutionOptions): UseToolExecutionResult {
  const [pendingApprovals, setPendingApprovals] = useState<PendingToolApproval[]>([]);

  // Track tool calls pending approval (deferred execution until user approves)
  const pendingApprovalToolCallsRef = useRef<Map<string, { name: string; input: unknown; toolCallData: { name: string; args: string } }>>(new Map());

  const handleApprovalRequest = useCallback((event: ToolApprovalRequestEvent) => {
    console.log('[useToolExecution] Tool approval requested:', event.toolCallName, event.toolCallId);
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

  // Execute a tool and send the response back to the server
  const executeToolCall = useCallback(async (
    toolCallId: string,
    name: string,
    input: unknown
  ) => {
    const client = clientRef.current;
    if (!client) {
      console.error('[useToolExecution] No client available for tool execution');
      return;
    }

    try {
      const ownerId = toolOwnershipRef.current.get(name);
      console.log(`[useToolExecution] Tool "${name}" owned by component:`, ownerId);

      console.log('[useToolExecution] Executing tool...');
      const result = await executeDefinedTool(aggregatedToolsRef.current, name, input);

      // Check if result indicates an error - if so, skip waiting for prompt change
      const isErrorResult = result && typeof result === 'object' &&
        ('error' in result || (result as Record<string, unknown>).success === false);

      // Check if component is invisible (no visual state to wait for)
      const ownerIsInvisible = ownerId ? isInvisible(ownerId) : false;

      // Wait for prompt to update (via waiter registered by useAI) unless it's an error or invisible
      if (ownerId && !isErrorResult && !ownerIsInvisible) {
        const waiter = getWaiter(ownerId);
        if (waiter) {
          console.log(`[useToolExecution] Waiting for prompt change from ${ownerId}...`);
          await waiter();
          console.log('[useToolExecution] Prompt change wait complete');
        }
      } else if (isErrorResult) {
        console.log('[useToolExecution] Tool returned error, skipping prompt wait');
      } else if (ownerIsInvisible) {
        console.log('[useToolExecution] Component is invisible, skipping prompt wait');
      }

      // Wait for tools to stabilize after execution
      // This is crucial for tools that cause navigation/component mount-unmount
      // (e.g., new page components registering their tools)
      console.log('[useToolExecution] Waiting for tools to stabilize...');
      await waitForToolsToStabilize();
      console.log('[useToolExecution] Tools stabilized');

      // Build updated state
      let updatedState: unknown = null;
      if (ownerId) {
        const prompt = promptsRef.current.get(ownerId);
        if (prompt) {
          updatedState = { context: prompt };
          console.log(`[useToolExecution] Updated state from ${ownerId}`);
        }
      }

      client.sendToolResponse(toolCallId, result, updatedState);
    } catch (err) {
      console.error('Tool execution error:', err);
      client.sendToolResponse(toolCallId, {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [clientRef, aggregatedToolsRef, toolOwnershipRef, promptsRef, isInvisible, getWaiter, waitForToolsToStabilize]);

  // Store a tool call as pending approval
  const storePendingToolCall = useCallback((
    toolCallId: string,
    name: string,
    input: unknown,
    toolCallData: { name: string; args: string }
  ) => {
    console.log(`[useToolExecution] Storing pending tool call "${name}" for approval`);
    pendingApprovalToolCallsRef.current.set(toolCallId, { name, input, toolCallData });
  }, []);

  // Execute a pending tool after approval
  const executePendingToolAfterApproval = useCallback(async (toolCallId: string) => {
    const pendingTool = pendingApprovalToolCallsRef.current.get(toolCallId);
    if (!pendingTool) {
      console.warn(`[useToolExecution] No pending tool found for ${toolCallId}`);
      return;
    }

    // Remove from pending map
    pendingApprovalToolCallsRef.current.delete(toolCallId);

    // Execute the tool
    await executeToolCall(toolCallId, pendingTool.name, pendingTool.input);
  }, [executeToolCall]);

  const approveAll = useCallback(async () => {
    if (!clientRef.current) return;
    console.log('[useToolExecution] Approving all tool calls:', pendingApprovals.length);

    // Get pending tools before clearing state
    const pendingTools = [...pendingApprovals];

    // Send approval responses to server
    for (const pending of pendingTools) {
      clientRef.current.sendToolApprovalResponse(pending.toolCallId, true);
    }

    // Clear pending approvals state
    setPendingApprovals([]);

    // Execute all pending tools
    for (const tool of pendingTools) {
      await executePendingToolAfterApproval(tool.toolCallId);
    }
  }, [clientRef, pendingApprovals, executePendingToolAfterApproval]);

  const rejectAll = useCallback((reason?: string) => {
    if (!clientRef.current) return;
    console.log('[useToolExecution] Rejecting all tool calls:', pendingApprovals.length, reason);

    // Get pending tools before clearing state
    const pendingTools = [...pendingApprovals];

    // Send rejection responses to server
    for (const pending of pendingTools) {
      clientRef.current.sendToolApprovalResponse(pending.toolCallId, false, reason);
    }

    // Clear pending approvals state
    setPendingApprovals([]);

    // Clean up pending tool calls map
    for (const tool of pendingTools) {
      pendingApprovalToolCallsRef.current.delete(tool.toolCallId);
    }
  }, [clientRef, pendingApprovals]);

  return {
    pendingApprovals,
    handleApprovalRequest,
    executeToolCall,
    storePendingToolCall,
    approveAll,
    rejectAll,
  };
}
