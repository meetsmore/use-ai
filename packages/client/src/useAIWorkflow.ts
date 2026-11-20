/**
 * TODO: We would prefer to have this in a separate package, but it creates bundling problems with shared react contexts.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAIContext } from './providers/useAIProvider';
import { type ToolsDefinition, type ToolAnnotations, type ToolExecutionContext, executeDefinedTool, convertToolsToDefinitions } from './defineTool';
import type {
  AGUIEvent,
  RunErrorEvent,
  TextMessageContentEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
  WorkflowStatus,
} from '@meetsmore-oss/use-ai-core';
import { EventType } from '@meetsmore-oss/use-ai-core';
import type { RunWorkflowMessage } from '@meetsmore-oss/use-ai-core';
import { v4 as uuidv4 } from 'uuid';

// Re-export WorkflowStatus for convenience
export type { WorkflowStatus } from '@meetsmore-oss/use-ai-core';

/** A workflow has no stop, so the signal its tools get never aborts. */
const NEVER_ABORTED_SIGNAL = new AbortController().signal;

/**
 * Progress update from a workflow execution.
 */
export interface WorkflowProgress {
  /** Current status of the workflow */
  status: WorkflowStatus;
  /** Text output from the workflow (if any) */
  text?: string;
  /** Error message (if status is 'error') */
  error?: string;
  /** Tool calls made during workflow execution */
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
  }>;
}

/**
 * A request for user approval before a workflow tool runs.
 *
 * A workflow asks for approval in two cases:
 * - The tool has `annotations: { destructiveHint: true }`. The request has `annotations`.
 * - The tool calls `ctx.requestApproval`. The request has `message` and `metadata`.
 */
export interface WorkflowApprovalRequest {
  /** Id of the tool call */
  toolCallId: string;
  /** Name of the tool, as given in `tools` */
  toolName: string;
  /** Arguments that the workflow gave the tool */
  args: Record<string, unknown>;
  /** The tool's annotations, for a `destructiveHint` approval */
  annotations?: ToolAnnotations;
  /** The message that the tool gave to `ctx.requestApproval` */
  message?: string;
  /** The metadata that the tool gave to `ctx.requestApproval` */
  metadata?: Record<string, unknown>;
}

/** The answer to a {@link WorkflowApprovalRequest}. */
export interface WorkflowApprovalResult {
  approved: boolean;
  /** Why the user rejected the tool call. The workflow gets it in the tool result. */
  reason?: string;
}

/**
 * Configuration for triggering a workflow.
 */
export interface TriggerWorkflowOptions {
  /** Input data for the workflow */
  inputs: Record<string, any>;
  /** Optional tools that the workflow can call */
  tools?: ToolsDefinition;
  /** Optional callback for progress updates */
  onProgress?: (progress: WorkflowProgress) => void;
  /** Optional callback when workflow completes successfully */
  onComplete?: (result: any) => void;
  /** Optional callback when workflow encounters an error */
  onError?: (error: Error) => void;
  /**
   * Asks the user to approve a tool call. A workflow has no chat approval UI,
   * so the caller shows its own prompt and resolves with the answer.
   *
   * Without this callback, a tool with `destructiveHint: true` does not run:
   * the workflow gets `{ rejected: true, reason }` as the tool result.
   * `ctx.requestApproval` resolves with `{ approved: false }`.
   *
   * @example
   * ```typescript
   * trigger({
   *   inputs,
   *   tools: { deleteRows },
   *   onApprovalRequest: async (request) => ({
   *     approved: window.confirm(`Allow ${request.toolName}?`),
   *   }),
   * });
   * ```
   */
  onApprovalRequest?: (request: WorkflowApprovalRequest) => Promise<WorkflowApprovalResult> | WorkflowApprovalResult;
}

/**
 * Result from the useAIWorkflow hook.
 */
export interface UseAIWorkflowResult {
  /** Triggers a workflow execution */
  trigger: (options: TriggerWorkflowOptions) => Promise<void>;
  /** Current status of the workflow */
  status: WorkflowStatus;
  /** Accumulated text output from the workflow */
  text: string | null;
  /** Error if workflow failed */
  error: Error | null;
  /** Whether the client is connected to the server */
  connected: boolean;
}

/**
 * React hook for triggering headless workflows.
 *
 * Workflows are different from chat-based agents:
 * - No conversation history (stateless)
 * - No chat UI involvement
 * - Can use external platforms (Dify, Flowise, etc.)
 * - Still supports tool calls to frontend
 *
 * Use this for button-triggered operations like:
 * - File upload processing
 * - Data transformations
 * - Multi-step background tasks
 * - External workflow integrations
 *
 * @param runner - The runner to use (e.g., 'dify', 'flowise', 'claude')
 * @param workflowId - The workflow identifier
 *
 * @example
 * ```typescript
 * import { useAIWorkflow } from '@meetsmore-oss/use-ai-plugin-workflows-client';
 * import { defineTool, z } from '@meetsmore-oss/use-ai-client';
 *
 * function PDFUploadButton() {
 *   const { trigger, status, text } = useAIWorkflow('dify', 'pdf-processor');
 *
 *   const insertText = defineTool(
 *     'Insert text into the document',
 *     z.object({ text: z.string() }),
 *     (input) => {
 *       document.body.appendChild(document.createTextNode(input.text));
 *       return { success: true };
 *     }
 *   );
 *
 *   const handleUpload = async (file: File) => {
 *     const pdfData = await file.arrayBuffer();
 *
 *     await trigger({
 *       inputs: { file: pdfData },
 *       tools: { insertText },
 *       onProgress: (progress) => console.log('Progress:', progress),
 *       onComplete: (result) => console.log('Completed:', result),
 *       onError: (error) => console.error('Error:', error),
 *     });
 *   };
 *
 *   return (
 *     <div>
 *       <input type="file" onChange={(e) => handleUpload(e.target.files[0])} />
 *       {status === 'running' && <p>Processing...</p>}
 *       {status === 'completed' && <p>Done! {text}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAIWorkflow(runner: string, workflowId: string): UseAIWorkflowResult {
  const { connected, client } = useAIContext();
  const [status, setStatus] = useState<WorkflowStatus>('idle');
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const currentWorkflowRef = useRef<{
    runId: string;
    threadId: string;
    tools: ToolsDefinition;
    onProgress?: (progress: WorkflowProgress) => void;
    onComplete?: (result: any) => void;
    onError?: (error: Error) => void;
    onApprovalRequest?: TriggerWorkflowOptions['onApprovalRequest'];
    /** Tool calls of this run, by id, while their arguments arrive */
    pendingToolCalls: Map<string, { name: string; args: string }>;
    unsubscribe: () => void;
    accumulatedText: string;
    toolCalls: Array<{
      toolName: string;
      args: Record<string, unknown>;
      result?: unknown;
    }>;
  } | null>(null);

  /**
   * Handles an event of the workflow run `runId`. The client gives this handler
   * only the events that the server marks with `runId` (see `onRunEvent`).
   */
  const handleWorkflowEvent = useCallback(async (runId: string, event: AGUIEvent) => {
    const currentWorkflow = currentWorkflowRef.current;
    if (!currentWorkflow || currentWorkflow.runId !== runId) return;

    switch (event.type) {
      case EventType.TOOL_CALL_START: {
        const startEvent = event as ToolCallStartEvent;
        currentWorkflow.pendingToolCalls.set(startEvent.toolCallId, { name: startEvent.toolCallName, args: '' });
        break;
      }

      case EventType.TOOL_CALL_ARGS: {
        const argsEvent = event as ToolCallArgsEvent;
        const toolCall = currentWorkflow.pendingToolCalls.get(argsEvent.toolCallId);
        if (toolCall) toolCall.args += argsEvent.delta;
        break;
      }

      case EventType.TEXT_MESSAGE_CONTENT: {
        const textEvent = event as TextMessageContentEvent;
        currentWorkflow.accumulatedText += textEvent.delta;
        setText(currentWorkflow.accumulatedText);

        currentWorkflow.onProgress?.({
          status: 'running',
          text: currentWorkflow.accumulatedText,
          toolCalls: currentWorkflow.toolCalls,
        });
        break;
      }

      case EventType.TOOL_CALL_END: {
        if (!client) break;

        const toolCallEvent = event as ToolCallEndEvent;
        const toolCallId = toolCallEvent.toolCallId;

        // The tool call's name and arguments, from this run's own events
        const toolCallData = currentWorkflow.pendingToolCalls.get(toolCallId);
        if (!toolCallData) {
          console.error(`[useAIWorkflow] Tool call ${toolCallId} not found`);
          break;
        }
        currentWorkflow.pendingToolCalls.delete(toolCallId);

        const toolName = toolCallData.name;
        const toolArgs: Record<string, unknown> = toolCallData.args ? JSON.parse(toolCallData.args) : {};
        const onApprovalRequest = currentWorkflow.onApprovalRequest;

        console.log(`[useAIWorkflow] Executing tool: ${toolName}`, toolArgs);
        console.log(`[useAIWorkflow] Available tools:`, Object.keys(currentWorkflow.tools));

        try {
          // A destructive tool runs only when the caller approves it.
          const annotations = currentWorkflow.tools[toolName]?._options?.annotations;
          if (annotations?.destructiveHint) {
            const approval: WorkflowApprovalResult = onApprovalRequest
              ? await onApprovalRequest({ toolCallId, toolName, args: toolArgs, annotations })
              : {
                  approved: false,
                  reason: `Tool "${toolName}" needs user approval, and the workflow has no onApprovalRequest handler`,
                };
            if (!approval.approved) {
              const rejection = { rejected: true, reason: approval.reason || 'User rejected tool execution' };
              currentWorkflow.toolCalls.push({ toolName, args: toolArgs, result: rejection });
              currentWorkflow.onProgress?.({
                status: 'running',
                text: currentWorkflow.accumulatedText,
                toolCalls: currentWorkflow.toolCalls,
              });
              client.sendToolResponse(toolCallId, rejection);
              break;
            }
          }

          // A workflow cannot be stopped, so the signal never aborts.
          // A runtime approval goes to the caller, and is rejected without a handler.
          const ctx: ToolExecutionContext = {
            toolCallId,
            signal: NEVER_ABORTED_SIGNAL,
            requestApproval: async ({ message, metadata }) => {
              if (!onApprovalRequest) return { approved: false, reason: 'The workflow has no onApprovalRequest handler' };
              return onApprovalRequest({
                toolCallId,
                toolName,
                args: toolArgs,
                message,
                ...(metadata !== undefined ? { metadata } : {}),
              });
            },
          };
          const result = await executeDefinedTool(currentWorkflow.tools, toolName, toolArgs, ctx);

          // Track tool call
          currentWorkflow.toolCalls.push({
            toolName,
            args: toolArgs,
            result,
          });

          currentWorkflow.onProgress?.({
            status: 'running',
            text: currentWorkflow.accumulatedText,
            toolCalls: currentWorkflow.toolCalls,
          });

          // Send result back to server
          client.sendToolResponse(toolCallId, result);
        } catch (err) {
          console.error('[useAIWorkflow] Tool execution error:', err);
          client.sendToolResponse(toolCallId, {
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
        break;
      }

      case EventType.RUN_FINISHED: {
        setStatus('completed');

        const result = {
          text: currentWorkflow.accumulatedText,
          toolCalls: currentWorkflow.toolCalls,
        };

        currentWorkflow.onProgress?.({
          status: 'completed',
          text: currentWorkflow.accumulatedText,
          toolCalls: currentWorkflow.toolCalls,
        });

        currentWorkflow.onComplete?.(result);

        // Clear workflow ref and stop listening to the run
        currentWorkflow.unsubscribe();
        currentWorkflowRef.current = null;
        break;
      }

      case EventType.RUN_ERROR: {
        const errorEvent = event as RunErrorEvent;
        const err = new Error(errorEvent.message);
        setError(err);
        setStatus('error');

        currentWorkflow.onProgress?.({
          status: 'error',
          error: errorEvent.message,
          text: currentWorkflow.accumulatedText,
          toolCalls: currentWorkflow.toolCalls,
        });

        currentWorkflow.onError?.(err);

        // Clear workflow ref and stop listening to the run
        currentWorkflow.unsubscribe();
        currentWorkflowRef.current = null;
        break;
      }
    }
  }, [client]);

  // Stop listening to a running workflow when the component unmounts
  useEffect(() => {
    return () => {
      currentWorkflowRef.current?.unsubscribe();
      currentWorkflowRef.current = null;
    };
  }, [client]);

  const trigger = useCallback(async (options: TriggerWorkflowOptions) => {
    if (!client?.isConnected()) {
      const err = new Error('Not connected to server');
      setError(err);
      options.onError?.(err);
      return;
    }

    // Prevent concurrent workflows
    if (currentWorkflowRef.current !== null) {
      const err = new Error('A workflow is already running. Wait for it to complete before triggering a new one.');
      setError(err);
      setStatus('error');
      options.onError?.(err);
      return;
    }

    // Reset state
    setStatus('running');
    setError(null);
    setText(null);

    const runId = uuidv4();
    const threadId = uuidv4();

    // Store workflow context. Listen only to the events of this run, so that
    // the events of a chat run on the same connection never reach the workflow.
    currentWorkflowRef.current = {
      runId,
      threadId,
      tools: options.tools || {},
      onProgress: options.onProgress,
      onComplete: options.onComplete,
      onError: options.onError,
      onApprovalRequest: options.onApprovalRequest,
      pendingToolCalls: new Map(),
      unsubscribe: client.onRunEvent(runId, (event) => {
        void handleWorkflowEvent(runId, event);
      }),
      accumulatedText: '',
      toolCalls: [],
    };

    // Convert tools to ToolDefinition format
    const toolDefinitions = options.tools ? convertToolsToDefinitions(options.tools) : [];

    // Send run_workflow message
    const message: RunWorkflowMessage = {
      type: 'run_workflow',
      data: {
        runner,
        workflowId,
        inputs: options.inputs,
        tools: toolDefinitions,
        runId,
        threadId,
      },
    };

    console.log('[useAIWorkflow] Sending run_workflow message:', message);

    // Send via socket
    client.send(message);

    options.onProgress?.({
      status: 'running',
    });
  }, [client, handleWorkflowEvent, runner, workflowId]);

  return {
    trigger,
    status,
    text,
    error,
    connected,
  };
}
