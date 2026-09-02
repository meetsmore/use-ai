import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { Chat, PersistedMessage } from '../providers/chatRepository/types';
import { getDisplayTextFromContent } from '../utils/messageContent';
import { mergeAssistantMessagesForDisplay, type MergedMessage } from '../utils/mergeAssistantMessages';
import { hasStreamedAnswerContent } from '../utils/streamingParts';
import type { SubmitMode } from '../utils/keyboard';
import type { AgentInfo, FeedbackValue, EnabledFeatures } from '../types';
import { DEFAULT_ENABLED_FEATURES } from '../types';
import type { FileAttachment, FileUploadConfig, FileProcessingState } from '../fileUpload/types';
import type { SavedCommand } from '../commands/types';
import { useSlashCommands } from '../hooks/useSlashCommands';
import { useFileUpload } from '../hooks/useFileUpload';
import { useStrings, useTheme } from '../theme';
import type { UseAIStrings, UseAITheme } from '../theme';
import type { ChatStreamingPart, ExecutingToolDisplay } from '../hooks/useServerEvents';
import {
  Slot,
  DefaultHeader,
  DefaultEmptyState,
  DefaultMessage,
  DefaultPendingIndicator,
  DefaultComposer,
  DefaultToolApproval,
  DefaultDisclaimer,
  type ChatSaveAsCommand,
  type ChatToolApproval,
  type UseAIChatComponentOverrides,
} from './chatSlots';

// Re-export types for backwards compatibility
export type UseAIChatPanelStrings = UseAIStrings;
export type UseAIChatPanelTheme = UseAITheme;

/**
 * @deprecated Use `PersistedMessage` directly instead.
 */
type Message = PersistedMessage;

/**
 * A message as shown in the panel. `streaming` marks the provisional entry
 * for the answer that is still arriving; it has no timestamp, feedback
 * buttons or persisted reasoning parts yet.
 */
type DisplayMessage = MergedMessage & { streaming?: boolean };

/** Stable identity so an omitted `streamingParts` does not re-render the slot. */
const EMPTY_STREAMING_PARTS: ChatStreamingPart[] = [];

/** Key for the provisional streaming message when no persisted id is known. */
const PROVISIONAL_MESSAGE_ID = 'streaming-answer';
/** Placeholder; the provisional message never shows a timestamp. */
const PROVISIONAL_CREATED_AT = new Date(0);

/**
 * Props for the chat panel component.
 */
export interface UseAIChatPanelProps {
  onSendMessage: (message: string, attachments?: FileAttachment[]) => void;
  /**
   * Aborts the in-flight run. When provided and `loading` is true (and no
   * tool is currently executing), the send button switches to a "stop"
   * button that calls this. Without `onAbort` the button stays disabled
   * during loading.
   */
  onAbort?: () => void;
  messages: Message[];
  loading: boolean;
  connected: boolean;
  /**
   * The in-flight answer split into ordered parts, and the only form the
   * streamed answer is passed in. Flattening it into what one bubble shows is
   * the `Message` slot's job.
   */
  streamingParts?: ChatStreamingPart[];
  /**
   * Id the streaming answer will be persisted under. While set, the streaming
   * answer renders as a provisional message with this id, so when the persisted
   * answer arrives under the same id React updates the bubble in place instead
   * of unmounting it. Without it the provisional bubble remounts on completion.
   * @default null
   * @example "msg_1723972800000_k3j9x2a"
   */
  streamingMessageId?: string | null;
  currentChatId?: string | null;
  onNewChat?: () => Promise<string | void>;
  onLoadChat?: (chatId: string) => Promise<void>;
  onDeleteChat?: (chatId: string) => Promise<void>;
  onListChats?: () => Promise<Array<Omit<Chat, 'messages'>>>;
  /** Gets the current chat */
  onGetChat?: () => Promise<Chat | null>;
  suggestions?: string[];
  availableAgents?: AgentInfo[];
  defaultAgent?: string | null;
  selectedAgent?: string | null;
  onAgentChange?: (agentId: string | null) => void;
  fileUploadConfig?: FileUploadConfig;
  /** File processing state for send-time transformations (e.g., OCR) */
  fileProcessing?: FileProcessingState | null;
  commands?: SavedCommand[];
  onSaveCommand?: (name: string, text: string) => Promise<string>;
  /**
   * Opt-out toggles for optional chat UI features. Each feature defaults to
   * enabled when omitted. `slashCommands` controls the "save as slash command"
   * UI (hover save button + inline editor); saved-command autocomplete is
   * unaffected.
   */
  enabledFeatures?: EnabledFeatures;
  onRenameCommand?: (id: string, newName: string) => Promise<void>;
  onDeleteCommand?: (id: string) => Promise<void>;
  /** Optional close button to render in header (for floating mode) */
  closeButton?: React.ReactNode;
  /** Currently executing tool info for status display */
  executingTool?: ExecutingToolDisplay | null;
  /** Whether feedback buttons are enabled (requires Langfuse on server) */
  feedbackEnabled?: boolean;
  /** Callback when user submits feedback on a message */
  onFeedback?: (messageId: string, traceId: string, feedback: FeedbackValue) => void;
  /** Pending tool approvals awaiting user confirmation */
  pendingApprovals?: ChatToolApproval[];
  /** Callback to approve all pending tool calls */
  onApproveToolCall?: () => void;
  /** Callback to reject all pending tool calls */
  onRejectToolCall?: (reason?: string) => void;
  /**
   * How the textarea should treat the Enter key.
   *
   * - `'enter'` (default): Enter submits, Shift+Enter inserts a newline. Suitable
   *   for desktop.
   * - `'mod-enter'`: Enter inserts a newline. Cmd/Ctrl+Enter submits. Recommended
   *   for mobile, where soft keyboards lack modifier keys and the user is
   *   expected to tap the send button.
   *
   * IME composition is always respected regardless of mode.
   *
   * @default 'enter'
   */
  submitMode?: SubmitMode;
  /** Replace individual regions while retaining the built-in behavior by default. */
  components?: UseAIChatComponentOverrides;
}

/**
 * Chat panel content - fills its container.
 * Use directly for embedded mode, or wrap with UseAIFloatingChatWrapper for floating mode.
 */
export function UseAIChatPanel({
  onSendMessage,
  onAbort,
  messages,
  loading,
  connected,
  streamingParts = EMPTY_STREAMING_PARTS,
  streamingMessageId = null,
  currentChatId,
  onNewChat,
  onLoadChat,
  onDeleteChat,
  onListChats,
  onGetChat,
  suggestions,
  availableAgents,
  defaultAgent,
  selectedAgent,
  onAgentChange,
  fileUploadConfig,
  fileProcessing,
  commands = [],
  onSaveCommand,
  enabledFeatures,
  onRenameCommand,
  onDeleteCommand,
  closeButton,
  executingTool,
  feedbackEnabled,
  onFeedback,
  pendingApprovals = [],
  onApproveToolCall,
  onRejectToolCall,
  submitMode = 'enter',
  components,
}: UseAIChatPanelProps) {
  const strings = useStrings();
  const theme = useTheme();

  // Opt-out features: each defaults to enabled via DEFAULT_ENABLED_FEATURES.
  const features = { ...DEFAULT_ENABLED_FEATURES, ...enabledFeatures };
  const slashCommandsEnabled = features.slashCommands;

  // Merge consecutive assistant messages within each turn into a single
  // display message. Intermediate messages (with toolCalls) have their text
  // combined with the final text-only message. Tool messages are filtered out.
  // This preserves per-step data structure (for LLM context) while showing
  // a unified bubble to the user.
  // Memoized: a run re-renders the panel on every streamed token, and the merge
  // walks the whole conversation.
  const displayMessages = useMemo(() => mergeAssistantMessagesForDisplay(messages), [messages]);
  const showInputDisclaimer = !!features.inputDisclaimer && displayMessages.length > 0;

  // True from the render that appends the persisted answer until the streaming
  // state clears. In that window the provisional entry below is gone but
  // `loading` is still true, so the pending indicator has to check this as well
  // or it draws a stray bubble under the finished answer.
  const persistedStreamingAnswer =
    !!streamingMessageId && displayMessages.some((m) => m.id === streamingMessageId);

  // The streaming answer is shown as a provisional assistant message under the
  // id it will be persisted with. When the persisted message arrives it takes
  // the same key, so React updates the existing bubble instead of replacing it,
  // and a text selection inside it survives. saveAIResponse appends the
  // persisted message one render before the streaming state clears, so the
  // provisional entry is skipped once a message with that id exists. `content`
  // stays empty: the answer is passed as `streamingParts`, and the slot decides
  // how to render it.
  const provisionalMessage: DisplayMessage | null =
    hasStreamedAnswerContent(streamingParts) && !persistedStreamingAnswer
      ? {
          id: streamingMessageId ?? PROVISIONAL_MESSAGE_ID,
          role: 'assistant',
          content: '',
          createdAt: PROVISIONAL_CREATED_AT,
          sourceMessages: [],
          streaming: true,
        }
      : null;
  const renderedMessages: DisplayMessage[] = provisionalMessage
    ? [...displayMessages, provisionalMessage]
    : displayMessages;

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [displayedSuggestions, setDisplayedSuggestions] = useState<string[]>([]);

  // File upload hook - includes processing state for transformation progress
  const {
    attachments,
    fileError,
    enabled: fileUploadEnabled,
    acceptedTypes,
    processingState: fileProcessingState,
    fileInputRef,
    removeAttachment,
    clearAttachments,
    openFilePicker,
    handleFileInputChange,
    getDropZoneProps,
    DropZoneOverlay,
  } = useFileUpload({
    getCurrentChat: onGetChat ?? (async () => null),
    config: fileUploadConfig,
    disabled: loading,
    resetDependency: currentChatId,
  });

  // Slash commands hook
  const slashCommands = useSlashCommands({
    commands,
    onCommandSelect: (text) => setInput(text),
    onSaveCommand,
    onRenameCommand,
    onDeleteCommand,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Randomly select up to 4 suggestions when messages become empty
  useEffect(() => {
    if (!suggestions || suggestions.length === 0) {
      setDisplayedSuggestions([]);
      return;
    }

    // Shuffle array and take up to 4 items
    const shuffled = [...suggestions].sort(() => Math.random() - 0.5);
    setDisplayedSuggestions(shuffled.slice(0, 4));
  }, [messages.length, suggestions]);

  const handleSend = () => {
    // Allow sending if there's text or attachments
    const hasContent = input.trim() || attachments.length > 0;
    if (!hasContent || !connected || loading) return;

    onSendMessage(input, attachments.length > 0 ? attachments : undefined);
    setInput('');
    clearAttachments();
    slashCommands.closeAutocomplete();
  };

  const handleInputValueChange = (value: string) => {
    setInput(value);
    slashCommands.handleInputChange(value);
  };

  /**
   * The save-as-slash-command affordance for a user message, or undefined when
   * the feature is off, the host takes no commands, or the message is not one
   * the user wrote.
   */
  const saveAsCommandFor = (message: DisplayMessage): ChatSaveAsCommand | undefined => {
    if (message.role !== 'user' || !slashCommandsEnabled || !onSaveCommand) return undefined;
    const text = getDisplayTextFromContent(message.content);

    return {
      isEditing: slashCommands.isSavingCommand(message.id),
      start: () => slashCommands.startSavingCommand(message.id, text),
      save: (name: string) => onSaveCommand(name, text),
      editor: slashCommands.renderInlineSaveUI({ messageId: message.id, messageText: text }),
    };
  };

  const composerPlaceholder = !connected
    ? strings.input.connectingPlaceholder
    : loading
      ? `${executingTool?.displayText ?? strings.input.thinking}...`
      : strings.input.placeholder;
  const canSend = !!(
    connected &&
    !loading &&
    pendingApprovals.length === 0 &&
    (input.trim() || attachments.length > 0)
  );
  const canAbort = loading && !!onAbort;

  return (
    <div
      onClick={() => {
        // Dismiss inline save command UI when clicking anywhere in the chat panel
        slashCommands.cancelInlineSave();
      }}
      {...getDropZoneProps()}
      style={{
        width: '100%',
        height: '100%',
        background: theme.backgroundColor,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: theme.fontFamily,
        position: 'relative',
      }}
    >
      {/* Drop zone overlay (shows when dragging files) */}
      {DropZoneOverlay}

      {/* Header */}
      <Slot
        component={components?.Header}
        fallback={DefaultHeader}
        props={{
          connected,
          messages: displayMessages,
          currentChatId: currentChatId ?? null,
          availableAgents: availableAgents ?? [],
          defaultAgent: defaultAgent ?? null,
          selectedAgent: selectedAgent ?? null,
          closeButton,
          onNewChat,
          onDeleteChat,
          onListChats,
          onLoadChat,
          onAgentChange,
        }}
      />

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {displayMessages.length === 0 && (
          <Slot
            component={components?.EmptyState}
            fallback={DefaultEmptyState}
            props={{
              suggestions: displayedSuggestions,
              connected,
              loading,
              onSelectSuggestion: (suggestion) => {
                if (connected && !loading) onSendMessage(suggestion);
              },
            }}
          />
        )}

        {renderedMessages.map((message, index) => (
          <Slot
            key={message.id}
            component={components?.Message}
            fallback={DefaultMessage}
            props={{
              message,
              index,
              isLast: index === renderedMessages.length - 1,
              sourceMessages: message.sourceMessages,
              streaming: !!message.streaming,
              streamingParts: message.streaming ? streamingParts : EMPTY_STREAMING_PARTS,
              feedbackEnabled: !!feedbackEnabled,
              onFeedback,
              saveAsCommand: saveAsCommandFor(message),
            }}
          />
        ))}

        {loading && !provisionalMessage && !persistedStreamingAnswer && (
          <Slot
            component={components?.PendingIndicator}
            fallback={DefaultPendingIndicator}
            props={{
              executingTool: executingTool ?? null,
              fileProcessing: fileProcessing ?? null,
            }}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {/* Hidden file input remains mounted even when Composer is replaced. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        data-testid="file-input"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
        accept={acceptedTypes?.join(',')}
      />

      {/* Tool approval is independent from Composer so replacing the input UI
          cannot accidentally remove the controls required to resume a run. */}
      {pendingApprovals.length > 0 && onApproveToolCall && onRejectToolCall && (
        <Slot
          component={components?.ToolApproval}
          fallback={DefaultToolApproval}
          props={{
            approvals: pendingApprovals,
            onApprove: onApproveToolCall,
            onReject: onRejectToolCall,
          }}
        />
      )}

      <Slot
        component={components?.Composer}
        fallback={DefaultComposer}
        props={{
          input,
          connected,
          loading,
          placeholder: composerPlaceholder,
          canSend,
          canAbort,
          attachments,
          fileUploadEnabled,
          fileError,
          pendingApprovals,
          onInputChange: handleInputValueChange,
          onSend: handleSend,
          onAbort,
          onOpenFilePicker: openFilePicker,
          onRemoveAttachment: removeAttachment,
          submitMode,
          attachmentProcessing: fileProcessingState,
          disclaimerVisible: showInputDisclaimer,
          slashCommands: {
            isOpen: slashCommands.isAutocompleteVisible,
            onKeyDown: slashCommands.handleKeyDown,
            list: slashCommands.AutocompleteComponent,
          },
        }}
      />

      {/* Keep the disclaimer independent from Composer so a full input UI
          replacement cannot accidentally remove configured safety copy. */}
      {showInputDisclaimer && (
        <Slot
          component={components?.Disclaimer}
          fallback={DefaultDisclaimer}
          props={{ text: strings.input.disclaimer }}
        />
      )}

      <style>{`
        /* Markdown content styles */
        .markdown-content > :first-child {
          margin-top: 0 !important;
        }
        .markdown-content > :last-child {
          margin-bottom: 0 !important;
        }
        .markdown-content p:last-child {
          margin-bottom: 0 !important;
        }
        .markdown-content ul:last-child,
        .markdown-content ol:last-child {
          margin-bottom: 0 !important;
        }
        .markdown-content pre:last-child {
          margin-bottom: 0 !important;
        }
      `}</style>
    </div>
  );
}

export type { Message };
