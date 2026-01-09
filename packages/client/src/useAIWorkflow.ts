/**
 * TODO: We would prefer to have this in a separate package, but it creates bundling problems with shared react contexts.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAIContext } from './providers/useAIProvider';
import { type ToolsDefinition, executeDefinedTool, convertToolsToDefinitions } from './defineTool';
import type { AGUIEvent, RunErrorEvent, TextMessageContentEvent, ToolCallEndEvent, WorkflowStatus } from '@meetsmore-oss/use-ai-core';
import { EventType } from '@meetsmore-oss/use-ai-core';
import type { RunWorkflowMessage } from '@meetsmore-oss/use-ai-core';
import { v4 as uuidv4 } from 'uuid';

// Re-export WorkflowStatus for convenience
export type { WorkflowStatus } from '@meetsmore-oss/use-ai-core';

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
    accumulatedText: string;
    toolCalls: Array<{
      toolName: string;
      args: Record<string, unknown>;
      result?: unknown;
    }>;
  } | null>(null);

  const eventListenerIdRef = useRef<string>(`useAIWorkflow-${Math.random().toString(36).substr(2, 9)}`);

  const handleWorkflowEvent = useCallback(async (event: AGUIEvent) => {
    const currentWorkflow = currentWorkflowRef.current;
    if (!currentWorkflow) return;

    // Only process events for the current workflow
    if (event.type === EventType.RUN_STARTED) {
      const runEvent = event;
      if (runEvent.runId !== currentWorkflow.runId) return;
    }

    switch (event.type) {
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

        // Get the accumulated tool call data from the client
        const toolCallData = client.getToolCallData(toolCallId);
        if (!toolCallData) {
          console.error(`[useAIWorkflow] Tool call ${toolCallId} not found`);
          break;
        }

        const toolName = toolCallData.name;
        const toolArgs = JSON.parse(toolCallData.args);

        console.log(`[useAIWorkflow] Executing tool: ${toolName}`, toolArgs);
        console.log(`[useAIWorkflow] Available tools:`, Object.keys(currentWorkflow.tools));

        try {
          // Execute the tool
          const result = await executeDefinedTool(currentWorkflow.tools, toolName, toolArgs);

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

        // Clear workflow ref
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

        // Clear workflow ref
        currentWorkflowRef.current = null;
        break;
      }
    }
  }, [client]);

  // Register event listener once
  useEffect(() => {
    if (!client) return;

    const unsubscribe = client.onEvent(eventListenerIdRef.current, handleWorkflowEvent);

    return () => {
      unsubscribe();
    };
  }, [client, handleWorkflowEvent]);

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

    // Store workflow context
    currentWorkflowRef.current = {
      runId,
      threadId,
      tools: options.tools || {},
      onProgress: options.onProgress,
      onComplete: options.onComplete,
      onError: options.onError,
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
