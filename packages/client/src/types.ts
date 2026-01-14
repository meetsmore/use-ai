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
  WorkflowStatus,
  UseAIClientMessage,
  RunWorkflowMessage,
  McpHeadersConfig,
  McpHeadersMap,
  AgentInfo,
  UseAIForwardedProps,
  // Multimodal content types
  TextContent,
  ImageContent,
  FileContent,
  MultimodalContent,
  UserMessageContent,
  // Citation types
  Citation,
  CitationEvent,
} from '@meetsmore-oss/use-ai-core';

export {
  EventType,
  ErrorCode,
  CITATION_EVENT_NAME,
  CITATION_MARKER_START,
  CITATION_MARKER_END,
  CITATION_MARKER_SEP,
  CITATION_PATTERN,
  CITATION_SYSTEM_INSTRUCTION,
  createCitationMarker,
  transformLegacyCitations,
} from '@meetsmore-oss/use-ai-core';
