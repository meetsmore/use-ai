import type React from 'react';
import type { AgentInfo, FeedbackValue, ToolAnnotations } from '../../types';
import type { Chat, PersistedMessage } from '../../providers/chatRepository/types';
import type { FileAttachment, FileProcessingState } from '../../fileUpload/types';
import type { ChatStreamingPart, ExecutingToolDisplay } from '../../hooks/useServerEvents';
import type { SubmitMode } from '../../utils/keyboard';

/** A tool call that is waiting for user approval. */
export interface ChatToolApproval {
  toolCallId: string;
  toolCallName: string;
  toolCallArgs: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

/** Common contract for chat component overrides. */
export interface ChatSlotProps {
  /** The built-in UI. Render this to decorate it, or omit it to replace it. */
  children?: React.ReactNode;
}

export interface ChatHeaderSlotProps extends ChatSlotProps {
  connected: boolean;
  messages: PersistedMessage[];
  currentChatId: string | null;
  availableAgents: AgentInfo[];
  defaultAgent: string | null;
  selectedAgent: string | null;
  closeButton?: React.ReactNode;
  onNewChat?: () => Promise<string | void>;
  onDeleteChat?: (chatId: string) => Promise<void>;
  onListChats?: () => Promise<Array<Omit<Chat, 'messages'>>>;
  onLoadChat?: (chatId: string) => Promise<void>;
  onAgentChange?: (agentId: string | null) => void;
}

export interface ChatEmptyStateSlotProps extends ChatSlotProps {
  suggestions: string[];
  connected: boolean;
  loading: boolean;
  onSelectSuggestion: (suggestion: string) => void;
}

export interface ChatMessageSlotProps extends ChatSlotProps {
  /**
   * While `streaming` is true this is the provisional entry for the answer that
   * is still arriving: `content` is empty and `createdAt`, `traceId`, `feedback`
   * and `reasoningParts` are not populated yet, so read the answer from
   * `streamingParts`. It carries the id the answer will be persisted under, so
   * the same slot instance keeps rendering it once the run finishes.
   *
   * The slot itself keeps its React key across that handoff, but the keys it
   * gives its own children must match on both sides too. Deriving them from
   * `streamingParts` while streaming and from `sourceMessages` afterwards
   * produces different keys for the same text, which remounts it and drops any
   * selection the user was making. Key by position within the turn rather than
   * by message id: a turn's earlier steps only get their ids once the turn is
   * persisted, so an id-derived key cannot be stable for them.
   */
  message: PersistedMessage;
  index: number;
  isLast: boolean;
  /**
   * The raw messages this entry was built from, in the order they were
   * produced: the per-step assistant messages with their `toolCalls` and
   * `reasoningParts`, and the `tool` messages holding each call's result.
   * Merging into one bubble drops all of that, so render from here instead when
   * the turn should read as a timeline. Empty while `streaming` is true.
   */
  sourceMessages: PersistedMessage[];
  /** Whether this message is the answer currently being streamed. */
  streaming: boolean;
  /**
   * The answer so far, split into the parts the model emitted and kept in
   * order: reasoning, text and tool calls as they happened. This is the
   * streaming counterpart of `sourceMessages`, so a slot can render a run the
   * same way while it happens and after it is persisted, and it is the only
   * place the streamed answer is available. Empty unless `streaming` is true.
   *
   * `getTextFromStreamingParts` and `getReasoningPartsFromStreamingParts`
   * flatten it the way a persisted turn is flattened, for a slot that wants one
   * bubble rather than a timeline.
   */
  streamingParts: ChatStreamingPart[];
  feedbackEnabled: boolean;
  onFeedback?: (messageId: string, traceId: string, feedback: FeedbackValue) => void;
  /**
   * Present on user messages when saving one as a slash command is available.
   * Absent when the feature is disabled or the host provided no save handler.
   */
  saveAsCommand?: ChatSaveAsCommand;
}

/** Turning a user message into a reusable slash command. */
export interface ChatSaveAsCommand {
  /** Whether the inline naming editor for this message is open. */
  isEditing: boolean;
  /** Opens the inline naming editor. */
  start: () => void;
  /** Saves the message as a command under `name`, resolving to its id. */
  save: (name: string) => Promise<string>;
  /** The built-in naming editor. Render it to reuse it, or build your own with `save`. */
  editor: React.ReactNode;
}

/**
 * The placeholder shown after a run starts but before the answer produces its
 * first token, and while a send-time file transformation (e.g. OCR) runs. A
 * tool call that runs before the answer says anything falls in this window too.
 * Once text or reasoning arrives the answer renders through the `Message` slot
 * instead, so this stops being rendered.
 */
export interface ChatPendingIndicatorSlotProps extends ChatSlotProps {
  /** The tool the run is waiting on, or null when it is not running one. */
  executingTool: ExecutingToolDisplay | null;
  /** The transformation running over an attachment, or null when none runs. */
  fileProcessing: FileProcessingState | null;
}

export interface ChatComposerSlotProps extends ChatSlotProps {
  input: string;
  connected: boolean;
  loading: boolean;
  placeholder: string;
  canSend: boolean;
  canAbort: boolean;
  attachments: FileAttachment[];
  fileUploadEnabled: boolean;
  fileError: string | null;
  pendingApprovals: ChatToolApproval[];
  onInputChange: (value: string) => void;
  onSend: () => void;
  onAbort?: () => void;
  onOpenFilePicker: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  /** How the Enter key should behave; see `UseAIChatProps.submitMode`. */
  submitMode: SubmitMode;
  /** Per-attachment transformation progress (e.g. OCR), keyed by attachment id. */
  attachmentProcessing: Map<string, FileProcessingState>;
  /**
   * Whether a disclaimer renders directly below the composer. The built-in
   * composer drops its bottom padding when it does.
   */
  disclaimerVisible: boolean;
  /**
   * The `/`-triggered command autocomplete. Wire `onKeyDown` into the input and
   * render `list` to keep completion working; ignore it to drop the feature.
   * `onInputChange` is already folded into this slot's own `onInputChange`.
   */
  slashCommands: ChatSlashCommands;
}

/** The `/`-triggered command autocomplete attached to the composer input. */
export interface ChatSlashCommands {
  /** Whether the autocomplete list is currently open. */
  isOpen: boolean;
  /** Feed key events here first; returns true when the autocomplete consumed the key. */
  onKeyDown: (event: React.KeyboardEvent) => boolean;
  /** The built-in autocomplete list, positioned relative to the composer input. */
  list: React.ReactNode;
}

export interface ChatToolApprovalSlotProps extends ChatSlotProps {
  approvals: ChatToolApproval[];
  onApprove: () => void;
  onReject: (reason?: string) => void;
}

export interface ChatDisclaimerSlotProps extends ChatSlotProps {
  /** The configured disclaimer text. */
  text: string;
}

/** Components that can replace individual regions of the built-in chat UI. */
export interface UseAIChatComponents {
  Header: React.ComponentType<ChatHeaderSlotProps>;
  EmptyState: React.ComponentType<ChatEmptyStateSlotProps>;
  Message: React.ComponentType<ChatMessageSlotProps>;
  PendingIndicator: React.ComponentType<ChatPendingIndicatorSlotProps>;
  Composer: React.ComponentType<ChatComposerSlotProps>;
  ToolApproval: React.ComponentType<ChatToolApprovalSlotProps>;
  Disclaimer: React.ComponentType<ChatDisclaimerSlotProps>;
}

/** Partial component overrides; omitted regions use the built-in implementation. */
export type UseAIChatComponentOverrides = Partial<UseAIChatComponents>;
