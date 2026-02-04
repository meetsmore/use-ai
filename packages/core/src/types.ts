// Import and re-export AG-UI core types
import type {
  Tool,
  Message,
  Context,
  RunAgentInput,
  State,
  // Lifecycle events
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  StepStartedEvent,
  StepFinishedEvent,
  // Text message events
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageChunkEvent,
  // Tool call events
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallChunkEvent,
  ToolCallResultEvent,
  // State events
  StateSnapshotEvent,
  StateDeltaEvent,
  MessagesSnapshotEvent,
  // Special events
  RawEvent,
  CustomEvent,
  // Activity events
  ActivitySnapshotEvent,
  ActivityDeltaEvent,
} from '@ag-ui/core';

/**
 * Error codes sent from server to client.
 * Used to identify specific error types for proper handling and messaging.
 */
export enum ErrorCode {
  /** Error when AI API is experiencing high load (HTTP 529) */
  API_OVERLOADED = 'API_OVERLOADED',
  /** Error when rate limit is exceeded (HTTP 429) */
  RATE_LIMITED = 'RATE_LIMITED',
  /** Generic error for unknown or unexpected errors */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export type {
  Tool,
  Message,
  Context,
  RunAgentInput,
  State,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  StepStartedEvent,
  StepFinishedEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageChunkEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallChunkEvent,
  ToolCallResultEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
  MessagesSnapshotEvent,
  RawEvent,
  CustomEvent,
  ActivitySnapshotEvent,
  ActivityDeltaEvent,
};

/**
 * Extended tool definition with use-ai specific features.
 * Extends AG-UI Tool type with confirmationRequired flag.
 */
export interface ToolDefinition {
  /** The unique name of the tool */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema describing the tool's input parameters */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Whether the tool requires explicit user confirmation before execution */
  confirmationRequired?: boolean;
}

/**
 * Base interface for all messages sent from client to server over WebSocket.
 * Uses AG-UI RunAgentInput format for agent execution.
 */
export interface ClientMessage {
  /** The type of message being sent */
  type: 'run_agent' | 'tool_result' | 'abort_run';
  /** The message payload */
  data: unknown;
}

/**
 * Message sent from client to server to run the agent.
 * Includes tools, messages, and state using AG-UI RunAgentInput format.
 */
export interface RunAgentMessage {
  type: 'run_agent';
  data: RunAgentInput;
}

/**
 * Message sent from client to server with the result of a tool execution.
 * This maps to AG-UI ToolCallResultEvent.
 */
export interface ToolResultMessage {
  type: 'tool_result';
  data: {
    /** Message ID for the tool result */
    messageId: string;
    /** The unique ID of the tool call being responded to */
    toolCallId: string;
    /** The result content (stringified) */
    content: string;
    /** Role is always 'tool' for tool results */
    role: 'tool';
  };
}

/**
 * Message sent from client to server to abort a running agent execution.
 */
export interface AbortRunMessage {
  type: 'abort_run';
  data: {
    /** Run ID to abort */
    runId: string;
  };
}

/**
 * AG-UI event type - all events from server to client.
 * Server emits AG-UI standard events.
 */
export type AGUIEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | TextMessageChunkEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallChunkEvent
  | ToolCallResultEvent
  | StateSnapshotEvent
  | StateDeltaEvent
  | MessagesSnapshotEvent
  | ActivitySnapshotEvent
  | ActivityDeltaEvent
  | RawEvent
  | CustomEvent;

// Export EventType enum separately to avoid conflicts
export { EventType } from '@ag-ui/core';

// ============================================================================
// use-ai Extensions
// ============================================================================
// The following types are use-ai-specific extensions and are NOT part of the
// AG-UI protocol. They provide additional functionality (like headless workflows)
// while keeping the core AG-UI protocol pure and compliant.

/**
 * HTTP headers configuration for a single MCP endpoint.
 * Can be used for authentication, custom headers, or any HTTP header needs.
 */
export interface McpHeadersConfig {
  /** HTTP headers to send to the MCP endpoint */
  headers: Record<string, string>;
}

/**
 * Information about an available agent on the server.
 */
export interface AgentInfo {
  /** The unique identifier/key for this agent */
  id: string;
  /** Human-readable name of the agent */
  name: string;
  /** Annotation/description shown in the agent selector UI */
  annotation?: string;
}

/**
 * Extended forwardedProps type for use-ai protocol.
 * Uses AG-UI's forwardedProps extension point for use-ai specific features.
 */
export interface UseAIForwardedProps {
  /** MCP headers configuration for MCP endpoint authentication */
  mcpHeaders?: McpHeadersMap;
  /** Agent ID to use for this request (falls back to server default if not specified) */
  agent?: string;
}

/**
 * Mapping of MCP endpoint patterns to HTTP headers configurations.
 * Patterns can be:
 * - Constant strings: `'https://api.example.com'` - Exact match
 * - Glob patterns: `'https://*.meetsmore.com'` - Wildcard matching using picomatch
 *
 * @example
 * ```typescript
 * {
 *   // Exact match
 *   'https://api.example.com': {
 *     headers: { 'Authorization': 'Bearer token123' }
 *   },
 *   // Wildcard subdomain
 *   'https://*.meetsmore.com': {
 *     headers: { 'X-API-Key': 'key456' }
 *   },
 *   // Multiple wildcards
 *   '*://*.example.com': {
 *     headers: { 'X-Custom': 'value' }
 *   }
 * }
 * ```
 */
export type McpHeadersMap = Record<string, McpHeadersConfig>;

/**
 * Status of a workflow execution.
 */
export type WorkflowStatus = 'idle' | 'running' | 'completed' | 'error';

/**
 * Extended message type for use-ai.
 * Includes AG-UI protocol messages ('run_agent', 'tool_result', 'abort_run')
 * plus use-ai-specific extensions ('run_workflow', 'message_feedback').
 *
 * Note: This extends beyond AG-UI protocol to support headless workflow triggers.
 * For AG-UI compliance, use ClientMessage instead.
 */
export interface UseAIClientMessage {
  type: 'run_agent' | 'tool_result' | 'abort_run' | 'run_workflow' | 'message_feedback';
  data: unknown;
}

/**
 * Feedback value for AI messages.
 * - 'upvote': Positive feedback (thumbs up)
 * - 'downvote': Negative feedback (thumbs down)
 * - null: No feedback / remove feedback
 */
export type FeedbackValue = 'upvote' | 'downvote' | null;

/**
 * Message sent from client to server with user feedback on an AI message.
 * Used to track user satisfaction and send feedback to Langfuse.
 */
export interface FeedbackMessage {
  type: 'message_feedback';
  data: {
    /** Client-side message ID for local state updates */
    messageId: string;
    /** Langfuse trace ID (runId from RUN_FINISHED event) */
    traceId: string;
    /** Feedback value: 'upvote' for positive, 'downvote' for negative, null to remove */
    feedback: FeedbackValue;
  };
}

/**
 * Message sent from client to server to run a workflow (headless execution).
 *
 * This is a use-ai-specific extension, NOT part of AG-UI protocol.
 * Used for triggering workflows without chat UI (e.g., button click, file upload).
 *
 * Workflows differ from agents:
 * - No conversation history (stateless)
 * - No chat UI involvement
 * - Can use external platforms (Dify, Flowise, etc.)
 * - Still supports tool calls to frontend
 *
 * @example
 * ```typescript
 * socket.emit('message', {
 *   type: 'run_workflow',
 *   data: {
 *     runner: 'dify',
 *     workflowId: 'pdf-processor',
 *     inputs: { file: pdfData },
 *     tools: [insertTextTool],
 *     runId: uuidv4(),
 *     threadId: uuidv4(),
 *   }
 * });
 * ```
 */
export interface RunWorkflowMessage {
  type: 'run_workflow';
  data: {
    /** The runner to use (e.g., 'dify', 'flowise') */
    runner: string;
    /** The workflow identifier (depends on which platform you are using) */
    workflowId: string;
    /** Input data for the workflow */
    inputs: Record<string, any>;
    /** Available tools that the workflow can call */
    tools?: ToolDefinition[];
    /** Run ID for tracking */
    runId: string;
    /** Thread ID for conversation tracking */
    threadId: string;
    /**
     * AG-UI extension point for additional fields in messages.
     * We use it to send `mcpHeaders`.
     * @see RunAgentInput['forwardedProps']
     */
    forwardedProps?: {
      /**
       * A map of current McpHeaders that should be applied to MCP tool calls (e.g. auth headers)
       */
      mcpHeaders?: McpHeadersMap
    }
  };
}

// ============================================================================
// Multimodal Content Types
// ============================================================================

/**
 * Text content part for multimodal messages.
 */
export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * Image content part for multimodal messages.
 * URL can be a data URL (base64) or a remote URL.
 */
export interface ImageContent {
  type: 'image';
  /** Image URL (data URL or remote URL) */
  url: string;
}

/**
 * File content part for multimodal messages.
 * Used for non-image files like PDFs, documents, etc.
 */
export interface FileContent {
  type: 'file';
  /** File URL (data URL or remote URL) */
  url: string;
  /** MIME type of the file */
  mimeType: string;
  /** Original file name */
  name: string;
}

/**
 * Transformed file content part for multimodal messages.
 * Created when a file is processed by a FileTransformer on the client.
 * The AI receives the transformed text, not the original file data.
 *
 * Note: This is internal to use-ai. The server converts this to plain text
 * before passing to the AI SDK, preserving AG-UI protocol compatibility.
 */
export interface TransformedFileContent {
  type: 'transformed_file';
  /** The transformed text representation of the file */
  text: string;
  /** Metadata about the original file (for display and context) */
  originalFile: {
    name: string;
    mimeType: string;
    size: number;
  };
}

/**
 * Content part for multimodal messages.
 * A message can contain multiple content parts of different types.
 */
export type MultimodalContent =
  | TextContent
  | ImageContent
  | FileContent
  | TransformedFileContent;

/**
 * User message content - can be a simple string or multimodal content array.
 * When multimodal, the array can contain text, images, and files.
 */
export type UserMessageContent = string | MultimodalContent[];
