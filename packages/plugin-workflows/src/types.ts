import type { ClientSession } from '@meetsmore-oss/use-ai-server';
import type { ToolDefinition, AGUIEvent } from '@meetsmore-oss/use-ai-core';

/**
 * Interface for emitting AG-UI protocol events.
 * All workflow runners must use this to communicate results to clients.
 */
export interface EventEmitter {
  /** Emit an AG-UI event to the client */
  emit<T extends AGUIEvent = AGUIEvent>(event: T): void;
}

/**
 * Input for executing a workflow.
 * Provides all context needed for a single workflow run.
 */
export interface WorkflowInput {
  /** The client session context */
  session: ClientSession;
  /** Unique identifier for this workflow run */
  runId: string;
  /** Unique identifier for the conversation thread */
  threadId: string;
  /** Workflow identifier (depends on which platform you are using) */
  workflowId: string;
  /** Workflow inputs (arbitrary JSON data) */
  inputs: Record<string, any>;
  /** Tools available for the workflow to call */
  tools: ToolDefinition[];
}

/**
 * Result from a workflow execution.
 * Indicates whether the workflow completed successfully and any final output.
 */
export interface WorkflowResult {
  /** Whether the workflow completed successfully */
  success: boolean;
  /** Error message if the workflow failed */
  error?: string;
  /** Optional output data from the workflow */
  output?: Record<string, any>;
}

/**
 * Abstract interface for workflow runners.
 *
 * Workflow runners integrate with external workflow platforms (Dify, Flowise, n8n, etc.)
 * or execute custom workflow logic. Unlike Agents (for conversational chat), workflow runners:
 * - Are stateless (no conversation history)
 * - Are triggered programmatically (not by user chat)
 * - Execute single-run operations
 * - Can still call frontend tools via AG-UI protocol
 *
 * All workflow runners must:
 * - Accept WorkflowInput with workflowId, inputs, and tools
 * - Emit AG-UI protocol events (TEXT_MESSAGE_*, TOOL_CALL_*, RUN_*, etc.)
 * - Handle tool call coordination (emit TOOL_CALL_START, wait for result, continue)
 * - Return WorkflowResult indicating success/failure
 *
 * @example
 * ```typescript
 * class MyWorkflowRunner implements WorkflowRunner {
 *   getName() {
 *     return 'my-platform';
 *   }
 *
 *   async execute(input: WorkflowInput, events: EventEmitter): Promise<WorkflowResult> {
 *     // 1. Emit RUN_STARTED
 *     events.emit({ type: EventType.RUN_STARTED, ... });
 *
 *     // 2. Execute workflow (call external platform API, etc.)
 *     const result = await myPlatform.executeWorkflow(input.workflowId, input.inputs);
 *
 *     // 3. Emit TEXT_MESSAGE_* events for responses
 *     events.emit({ type: EventType.TEXT_MESSAGE_START, ... });
 *
 *     // 4. For tool calls, emit TOOL_CALL_START and wait for results
 *     events.emit({ type: EventType.TOOL_CALL_START, ... });
 *     const toolResult = await waitForToolResult(toolCallId, input.session);
 *
 *     // 5. Emit RUN_FINISHED
 *     events.emit({ type: EventType.RUN_FINISHED, ... });
 *
 *     return { success: true, output: result };
 *   }
 * }
 * ```
 */
export interface WorkflowRunner {
  /**
   * Returns the unique identifier for this workflow runner.
   * Used for selecting runners when triggering workflows.
   *
   * @example
   * ```typescript
   * getName(): string {
   *   return 'dify';
   * }
   * ```
   */
  getName(): string;

  /**
   * Executes a workflow with the given input.
   * Must emit AG-UI events and coordinate tool execution.
   *
   * @param input - The workflow context (session, workflowId, inputs, tools)
   * @param events - Event emitter for sending AG-UI events to client
   * @returns Promise resolving to the workflow result
   */
  execute(input: WorkflowInput, events: EventEmitter): Promise<WorkflowResult>;
}
