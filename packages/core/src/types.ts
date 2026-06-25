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
  // Reasoning events
  ReasoningStartEvent,
  ReasoningMessageStartEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningEndEvent,
  ReasoningEncryptedValueEvent,
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
  /**
   * Error when the connection to the server was lost mid-run.
   * Synthesized by the client when a disconnect occurs while an AI run is in
   * progress; the server-side session is unrecoverable, so the in-flight
   * response is dropped and the UI is reset.
   */
  CONNECTION_LOST = 'CONNECTION_LOST',
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
  ReasoningStartEvent,
  ReasoningMessageStartEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningEndEvent,
  ReasoningEncryptedValueEvent,
};

/**
 * Extended tool definition with use-ai specific features.
 * Aligns with MCP Tool type, using annotations for behavior hints.
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
  /** MCP-aligned annotations for tool behavior hints */
  annotations?: ToolAnnotations;
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
    /**
     * use-ai extension point for mid-run updates.
     * Follows the same pattern as AG-UI's forwardedProps on RunAgentInput.
     */
    forwardedProps?: ToolResultForwardedProps;
  };
}

/**
 * use-ai extension props for tool results.
 * Allows mid-run updates to tools and state (e.g., after navigation).
 */
export interface ToolResultForwardedProps {
  /**
   * Current tool definitions from the client.
   * Sent with each tool result to allow mid-run tool updates
   * (e.g., when navigation causes new components to mount).
   */
  tools?: ToolDefinition[];
  /**
   * Current application state from all components.
   * Sent with each tool result to allow mid-run state updates
   * (e.g., when navigation causes new components with different state to mount).
   */
  state?: unknown;
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
  | ReasoningStartEvent
  | ReasoningMessageStartEvent
  | ReasoningMessageContentEvent
  | ReasoningMessageEndEvent
  | ReasoningEndEvent
  | ReasoningEncryptedValueEvent
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
 * Tool annotations following the MCP (Model Context Protocol) specification.
 * These are optional hints about tool behavior for UX purposes.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/tools
 */
export interface ToolAnnotations {
  /** Human-readable title for the tool, shown in UI while executing */
  title?: string;
  /** If true, the tool does not modify its environment (default: false) */
  readOnlyHint?: boolean;
  /** If true, the tool may perform destructive updates (default: true in MCP spec, but we default to false) */
  destructiveHint?: boolean;
  /** If true, calling repeatedly with same args has no additional effect (default: false) */
  idempotentHint?: boolean;
  /** If true, tool interacts with external/unpredictable entities (default: true) */
  openWorldHint?: boolean;
}

/**
 * use-ai extensions to the AG-UI ToolCallStartEvent.
 * These fields are optional to maintain compatibility with standard AG-UI services.
 */
export interface ToolCallStartExtensions {
  /** MCP tool annotations (for displaying status text, etc.) */
  annotations?: ToolAnnotations;
}

// ============================================================================
// Tool Approval Events (use-ai extension)
// ============================================================================

/**
 * Event type for tool approval requests.
 * This is a use-ai extension, not part of AG-UI protocol.
 */
export const TOOL_APPROVAL_REQUEST = 'TOOL_APPROVAL_REQUEST' as const;

/**
 * Event emitted when a tool requires user approval before execution.
 * This happens when a tool has `annotations.destructiveHint: true`.
 *
 * The client should display a confirmation dialog and respond with
 * a tool_approval_response message.
 */
export interface ToolApprovalRequestEvent {
  type: typeof TOOL_APPROVAL_REQUEST;
  /** Unique ID for this tool call */
  toolCallId: string;
  /** Name of the tool requesting approval */
  toolCallName: string;
  /** Arguments the tool will be called with */
  toolCallArgs: Record<string, unknown>;
  /** Tool annotations for UI display */
  annotations?: ToolAnnotations;
  /** Timestamp when this event was generated */
  timestamp: number;
  /** Optional message explaining why approval is needed (runtime approval) */
  message?: string;
  /** Optional metadata for the approval request (runtime approval) */
  metadata?: Record<string, unknown>;
}

/**
 * Message sent from client to server to approve or reject a tool execution.
 */
export interface ToolApprovalResponseMessage {
  type: 'tool_approval_response';
  data: {
    /** The tool call ID being approved/rejected */
    toolCallId: string;
    /** Whether the tool execution is approved */
    approved: boolean;
    /** Optional reason for rejection (shown to AI) */
    reason?: string;
  };
}

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
  /** Telemetry metadata for observability (e.g., Langfuse eval tracing) */
  telemetryMetadata?: Record<string, unknown>;
  /** Authentication token for server-side validation (e.g., JWT for beforeRunAgent plugin hooks) */
  token?: string;
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
 * plus use-ai-specific extensions ('run_workflow', 'message_feedback', 'tool_approval_response').
 *
 * Note: This extends beyond AG-UI protocol to support headless workflow triggers.
 * For AG-UI compliance, use ClientMessage instead.
 */
export interface UseAIClientMessage {
  type: 'run_agent' | 'tool_result' | 'abort_run' | 'run_workflow' | 'message_feedback' | 'tool_approval_response';
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
     * @see UseAIForwardedProps
     */
    forwardedProps?: UseAIForwardedProps
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
 * Image content part for multimodal messages. One of two variants, since a part
 * carries either a usable URL or a storage ref, never both:
 *
 * - `image_url`: a directly usable `url` (a data URL / base64, or a remote URL).
 * - `image_ref`: an opaque, durable storage `ref` (e.g. an S3 key). It is not
 *   usable as-is; before a run, the host's {@link ResolveAttachments} resolves it
 *   into an `image_url`. Unlike a url it does not go stale, so it survives history
 *   persistence and multi-turn resends.
 */
export type ImageContent =
  | { type: 'image_url'; url: string }
  | { type: 'image_ref'; ref: string };

/**
 * File content part for multimodal messages (non-image files such as PDFs and
 * documents). One of two variants; see {@link ImageContent} for the `url`/`ref`
 * distinction.
 */
export type FileContent =
  | { type: 'file_url'; url: string; mimeType: string; name: string }
  | { type: 'file_ref'; ref: string; mimeType: string; name: string };

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

/**
 * Context passed to the {@link ResolveAttachments} function when the server
 * resolves storage refs before a run.
 */
export interface ResolveAttachmentsContext {
  /** The props forwarded to this run ({@link UseAIForwardedProps}). */
  forwardedProps?: UseAIForwardedProps;
}

/**
 * A host-provided seam for converting attachment refs into a model-readable form.
 *
 * Called once at the start of a run (not per step), with all ref-bearing parts
 * collected from the entire message history passed together. The host returns a
 * replacement for each part in the same order and the same count. use-ai does not
 * interpret the parts; it passes them straight back before converting to AI SDK format.
 *
 * How refs are resolved, authorization, and handling of missing files are all the
 * host's responsibility. The returned parts must be in a form use-ai understands —
 * `{ type: 'image_url', url }` / `{ type: 'file_url', url, mimeType, name }` / `{ type: 'text', text }`.
 * The tag is authoritative: a part left tagged `image_ref`/`file_ref` is treated as
 * unresolved and dropped (with a warning), even if it also carries a `url`.
 * Since resolution happens only once at the start of a run, the returned urls must
 * stay valid for the entire run.
 *
 * @param parts - The ref-bearing parts collected from the run's full history.
 * @param context - The run context, including the forwarded props.
 * @returns The replacement parts, in the same length and order as `parts`.
 */
export type ResolveAttachments = (
  parts: MultimodalContent[],
  context: ResolveAttachmentsContext,
) => Promise<MultimodalContent[]>;

/**
 * Reasoning part for persisted messages.
 * Stores the reasoning text and optional encrypted value for state continuity.
 * The encryptedValue carries opaque provider data (e.g., Anthropic's signature
 * for multi-turn reasoning context) as a JSON string.
 */
export interface ReasoningPart {
  text: string;
  /** Opaque encrypted value for state continuity (e.g., JSON-serialized provider metadata) */
  encryptedValue?: string;
}
