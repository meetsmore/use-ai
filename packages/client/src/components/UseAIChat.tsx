import React, { createContext, useContext } from 'react';
import { UseAIChatPanel } from './UseAIChatPanel';
import { UseAIFloatingChatWrapper, CloseButton } from './UseAIFloatingChatWrapper';
import type { Message } from './UseAIChatPanel';
import type { AgentInfo, FeedbackValue } from '../types';
import type { FileUploadConfig, FileAttachment } from '../fileUpload/types';
import type { SavedCommand } from '../commands/types';
import type { Chat } from '../providers/chatRepository/types';

/**
 * Internal context value for chat UI state.
 * This is populated by UseAIProvider and consumed by UseAIChat.
 */
export interface ChatUIContextValue {
  /** Whether connected to the server */
  connected: boolean;
  /** Whether the AI is processing */
  loading: boolean;
  /** Send a message with optional file attachments */
  sendMessage: (message: string, attachments?: FileAttachment[]) => void;
  /** Current messages in the conversation */
  messages: Message[];
  /** Currently streaming text from assistant (real-time updates) */
  streamingText: string;
  /** Aggregated suggestions from all useAI hooks */
  suggestions: string[];
  /** File upload configuration */
  fileUploadConfig: FileUploadConfig | undefined;
  /** Chat history management */
  history: {
    /** The current chat ID */
    currentId: string | null;
    /** Creates a new chat and switches to it */
    create: () => Promise<string | void>;
    /** Loads an existing chat by ID */
    load: (chatId: string) => Promise<void>;
    /** Deletes a chat by ID */
    delete: (chatId: string) => Promise<void>;
    /** Lists all available chats */
    list: () => Promise<Array<Omit<Chat, 'messages'>>>;
    /** Gets the current chat (with frozen metadata) */
    get: () => Promise<Chat | null>;
  };
  /** Agent selection */
  agents: {
    /** List of available agents from the server */
    available: AgentInfo[];
    /** The default agent ID from the server */
    default: string | null;
    /** The currently selected agent ID (null means use server default) */
    selected: string | null;
    /** Sets the agent to use for requests */
    set: (agentId: string | null) => void;
  };
  /** Command management */
  commands: {
    /** List of saved slash commands */
    list: SavedCommand[];
    /** Saves a new command */
    save: (name: string, text: string) => Promise<string>;
    /** Renames an existing command */
    rename: (id: string, newName: string) => Promise<void>;
    /** Deletes a command by ID */
    delete: (id: string) => Promise<void>;
  };
  /** UI state for floating chat */
  ui: {
    /** Whether the floating chat is open */
    isOpen: boolean;
    /** Set the chat open state */
    setOpen: (open: boolean) => void;
  };
  /** Feedback functionality */
  feedback?: {
    /** Whether feedback is enabled (requires Langfuse on server) */
    enabled: boolean;
    /** Submit feedback for a message */
    submit: (messageId: string, traceId: string, feedback: FeedbackValue) => void;
  };
}

/**
 * Internal context for chat UI state.
 * @internal
 */
export const __UseAIChatContext = createContext<ChatUIContextValue | null>(null);

/**
 * Hook to access chat UI context.
 * @internal
 */
function useChatUIContext(): ChatUIContextValue {
  const context = useContext(__UseAIChatContext);
  if (!context) {
    throw new Error(
      'UseAIChat must be used within a UseAIProvider. ' +
      'Make sure UseAIChat is a descendant of UseAIProvider.'
    );
  }
  return context;
}

/**
 * Props for UseAIChat component.
 */
export interface UseAIChatProps {
  /**
   * When true, renders as a floating panel with backdrop.
   * When false (default), renders inline filling its container.
   */
  floating?: boolean;
}

/**
 * Standalone chat component that can be placed anywhere within UseAIProvider.
 *
 * Use this when you want to control where the chat UI is rendered,
 * such as embedding it in a sidebar or specific container.
 *
 * @example
 * ```tsx
 * // Embedded in a sidebar
 * <UseAIProvider serverUrl="ws://localhost:8081" renderChat={false}>
 *   <div style={{ display: 'flex', height: '100vh' }}>
 *     <MainContent style={{ flex: 1 }} />
 *     <aside style={{ width: 380 }}>
 *       <UseAIChat />
 *     </aside>
 *   </div>
 * </UseAIProvider>
 *
 * // Floating mode (manually controlled)
 * <UseAIProvider serverUrl="ws://localhost:8081" renderChat={false}>
 *   <App />
 *   <UseAIChat floating />
 * </UseAIProvider>
 * ```
 */
export function UseAIChat({ floating = false }: UseAIChatProps) {
  const ctx = useChatUIContext();

  const chatPanelProps = {
    onSendMessage: ctx.sendMessage,
    messages: ctx.messages,
    loading: ctx.loading,
    connected: ctx.connected,
    streamingText: ctx.streamingText,
    currentChatId: ctx.history.currentId,
    onNewChat: ctx.history.create,
    onLoadChat: ctx.history.load,
    onDeleteChat: ctx.history.delete,
    onListChats: ctx.history.list,
    onGetChat: ctx.history.get,
    suggestions: ctx.suggestions,
    availableAgents: ctx.agents.available,
    defaultAgent: ctx.agents.default,
    selectedAgent: ctx.agents.selected,
    onAgentChange: ctx.agents.set,
    fileUploadConfig: ctx.fileUploadConfig,
    commands: ctx.commands.list,
    onSaveCommand: ctx.commands.save,
    onRenameCommand: ctx.commands.rename,
    onDeleteCommand: ctx.commands.delete,
    feedbackEnabled: ctx.feedback?.enabled,
    onFeedback: ctx.feedback?.submit,
  };

  if (floating) {
    return (
      <UseAIFloatingChatWrapper
        isOpen={ctx.ui.isOpen}
        onClose={() => ctx.ui.setOpen(false)}
      >
        <UseAIChatPanel
          {...chatPanelProps}
          closeButton={<CloseButton onClick={() => ctx.ui.setOpen(false)} />}
        />
      </UseAIFloatingChatWrapper>
    );
  }

  return <UseAIChatPanel {...chatPanelProps} />;
}
