import type { UseAITransport } from './transport/types';

/**
 * How the provider reaches the server. Give one of the two.
 *
 * - `serverUrl` connects over Socket.IO, which the bundled server serves.
 * - `transport` connects over anything that implements {@link UseAITransport}.
 *
 * @example
 * ```tsx
 * <UseAIProvider serverUrl="wss://your-server.com">
 * <UseAIProvider transport={new WebSocketTransport('wss://your-server.com')}>
 * ```
 */
export type UseAIConfig =
  | {
      /** URL of a Socket.IO UseAI server. */
      serverUrl: string;
      transport?: never;
    }
  | {
      /**
       * Transport to reach the server with. The provider reads it once, on the first
       * render, so an inline object does not reconnect the client on every render.
       * Remount the provider to change transports.
       */
      transport: UseAITransport;
      serverUrl?: never;
    };

/**
 * Toggles for optional chat UI features. Opt-out features default to enabled
 * when their flag is omitted; opt-in features default to disabled. The default
 * is documented on each flag.
 */
export interface EnabledFeatures {
  /**
   * The "save as slash command" UI (hover save button + inline save editor)
   * on user messages. Saved-command autocomplete via "/" is unaffected.
   * @default true
   */
  slashCommands?: boolean;
  /**
   * The disclaimer shown under the input box once a conversation has started,
   * reminding the user that the AI can be wrong. Hidden on an empty chat.
   * Override the text via `strings.input.disclaimer`.
   * @default false
   */
  inputDisclaimer?: boolean;
}

/**
 * Default state for every opt-out feature. Merge user-supplied
 * `enabledFeatures` over this to resolve effective flags. Extend this constant
 * when adding a new opt-out toggle; opt-in features are left out so they stay
 * undefined until the consumer turns them on.
 */
export const DEFAULT_ENABLED_FEATURES: Pick<Required<EnabledFeatures>, 'slashCommands'> = {
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
