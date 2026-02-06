/**
 * Configuration for the UseAI client provider.
 */
export interface UseAIConfig {
  /** The WebSocket URL of the UseAI server */
  serverUrl: string;
}

// Re-export all types from @meetsmore-oss/use-ai-core for convenience
export type {
  ToolDefinition,
  ToolAnnotations,
  // AG-UI types
  Tool,
  Message,
  Context,
  RunAgentInput,
  State,
  RunAgentMessage,
  ToolResultMessage,
  AbortRunMessage,
  // AG-UI event types
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
  AGUIEvent,
  // use-ai extensions
  ToolCallStartExtensions,
  WorkflowStatus,
  UseAIClientMessage,
  RunWorkflowMessage,
  FeedbackMessage,
  FeedbackValue,
  McpHeadersConfig,
  McpHeadersMap,
  AgentInfo,
  UseAIForwardedProps,
  // Tool approval types
  ToolApprovalRequestEvent,
  ToolApprovalResponseMessage,
  // Multimodal content types
  TextContent,
  ImageContent,
  FileContent,
  MultimodalContent,
  UserMessageContent,
} from '@meetsmore-oss/use-ai-core';

export { EventType, ErrorCode, TOOL_APPROVAL_REQUEST } from '@meetsmore-oss/use-ai-core';
