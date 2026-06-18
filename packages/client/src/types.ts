/**
 * Configuration for the UseAI client provider.
 */
export interface UseAIConfig {
  /** The WebSocket URL of the UseAI server */
  serverUrl: string;
}

/**
 * Toggles for optional chat UI features. Each feature defaults to enabled
 * when its flag is omitted, so set a flag to false to opt out of that feature.
 */
export interface EnabledFeatures {
  /**
   * The "save as slash command" UI (hover save button + inline save editor)
   * on user messages. Saved-command autocomplete via "/" is unaffected.
   * @default true
   */
  slashCommands?: boolean;
}

/**
 * Default state for every opt-out feature. Merge user-supplied
 * `enabledFeatures` over this to resolve effective flags. Extend this constant
 * when adding a new feature toggle.
 */
export const DEFAULT_ENABLED_FEATURES: Required<EnabledFeatures> = {
  slashCommands: true,
};

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
  // Reasoning event types (AG-UI protocol)
  ReasoningStartEvent,
  ReasoningMessageStartEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningEndEvent,
  ReasoningEncryptedValueEvent,
  ReasoningPart,
  // Multimodal content types
  TextContent,
  ImageContent,
  FileContent,
  MultimodalContent,
  UserMessageContent,
} from '@meetsmore-oss/use-ai-core';

export { EventType, ErrorCode, TOOL_APPROVAL_REQUEST } from '@meetsmore-oss/use-ai-core';
