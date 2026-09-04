import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import type { UseAIConfig, AGUIEvent, AgentInfo, UseAIForwardedProps, EnabledFeatures } from '../types';
import { UseAIFloatingButton } from '../components/UseAIFloatingButton';
import { UseAIChatPanel } from '../components/UseAIChatPanel';
import { UseAIFloatingChatWrapper, CloseButton } from '../components/UseAIFloatingChatWrapper';
import { __UseAIChatContext, type ChatUIContextValue } from '../components/UseAIChat';
import { UseAIClient } from '../client';
import { convertToolsToDefinitions, type ToolsDefinition } from '../defineTool';
import type { ChatRepository, Chat, ChatMetadata, CreateChatOptions, PersistedMessage, PersistedMessageContent } from './chatRepository/types';
import { LocalStorageChatRepository } from './chatRepository/LocalStorageChatRepository';
import type { FileAttachment, FileUploadConfig, FileProcessingState } from '../fileUpload/types';
import { processAttachments } from '../fileUpload/processAttachments';
import { buildPersistedParts } from '../fileUpload/buildPersistedParts';
import { EmbedFileUploadBackend } from '../fileUpload/EmbedFileUploadBackend';
import type { MultimodalContent } from '@meetsmore-oss/use-ai-core';
import type { CommandRepository, SavedCommand } from '../commands/types';
import { useChatManagement } from '../hooks/useChatManagement';
import { useAgentSelection } from '../hooks/useAgentSelection';
import { useCommandManagement } from '../hooks/useCommandManagement';
import { useToolSystem, type RegisterToolsOptions } from '../hooks/useToolSystem';
import type { SubmitMode } from '../utils/keyboard';
import { usePromptState } from '../hooks/usePromptState';
import { useFeedback } from '../hooks/useFeedback';
import { useServerEvents, type ChatStreamingPart } from '../hooks/useServerEvents';
import { useMessageQueue, type SendMessageOptions } from '../hooks/useMessageQueue';
import { ThemeContext, StringsContext, defaultTheme, defaultStrings } from '../theme';
import type { UseAITheme, UseAIStrings } from '../theme';
import type { UseAIChatComponentOverrides } from '../components/chatSlots';

/** Stable identity so a hidden chat's streaming parts do not re-render consumers. */
const EMPTY_STREAMING_PARTS: ChatStreamingPart[] = [];

// ── Context Types ───────────────────────────────────────────────────────────

/**
 * Chat management context (from useChatManagement hook).
 */
export interface ChatContextValue {
  /** The current chat ID */
  currentId: string | null;
  /** Creates a new chat and switches to it */
  create: (options?: CreateChatOptions) => Promise<string>;
  /** Loads an existing chat by ID */
  load: (chatId: string) => Promise<void>;
  /** Deletes a chat by ID */
  delete: (chatId: string) => Promise<void>;
  /** Lists all available chats */
  list: () => Promise<Array<Omit<Chat, 'messages'>>>;
  /** Clears the current chat messages */
  clear: () => Promise<void>;
  /**
   * Programmatically send a message to the chat.
   * Throws on failure (e.g., not connected).
   */
  sendMessage: (message: string, options?: SendMessageOptions) => Promise<void>;
  /** Get the current chat object. Metadata is frozen to prevent accidental mutation. */
  get: () => Promise<Chat | null>;
  /**
   * Update metadata for the current chat.
   * @param metadata Metadata to set/merge
   * @param overwrite If true, replaces all metadata instead of merging (default: false)
   */
  updateMetadata: (metadata: ChatMetadata, overwrite?: boolean) => Promise<void>;
}

/**
 * Agent selection context (from useAgentSelection hook).
 */
export interface AgentContextValue {
  /** List of available agents from the server */
  available: AgentInfo[];
  /** The default agent ID from the server */
  default: string | null;
  /** The currently selected agent ID (null means use server default) */
  selected: string | null;
  /** Sets the agent to use for requests */
  set: (agentId: string | null) => void;
}

/**
 * Command management context (from useCommandManagement hook).
 */
export interface CommandContextValue {
  /** List of saved slash commands */
  list: SavedCommand[];
  /** Refreshes the commands list from storage */
  refresh: () => Promise<void>;
  /** Saves a new command */
  save: (name: string, text: string) => Promise<string>;
  /** Renames an existing command */
  rename: (id: string, newName: string) => Promise<void>;
  /** Deletes a command by ID */
  delete: (id: string) => Promise<void>;
}

/**
 * Tool system context (from useToolSystem hook).
 */
export interface ToolRegistryContextValue {
  /** Registers tools for a specific component */
  register: (id: string, tools: ToolsDefinition, options?: RegisterToolsOptions) => void;
  /** Unregisters tools for a specific component */
  unregister: (id: string) => void;
  /** Signals that a component has completed registration in useLayoutEffect */
  signalReady: (id: string) => void;
  /** Registers a waiter function for a component */
  registerWaiter: (id: string, waiter: () => Promise<void>) => void;
  /** Unregisters a waiter function */
  unregisterWaiter: (id: string) => void;
}

/**
 * Prompt management context.
 */
export interface PromptsContextValue {
  /** Updates the prompt and suggestions for a specific component */
  update: (id: string, prompt?: string, suggestions?: string[]) => void;
}

/**
 * Context value provided by UseAIProvider.
 * Contains connection state and methods for managing tools and prompts.
 */
export interface UseAIContextValue {
  /** URL of the server, when the provider was given `serverUrl` rather than `transport`. */
  serverUrl?: string;
  /** Whether the client is connected to the server */
  connected: boolean;
  /** The underlying WebSocket client instance */
  client: UseAIClient | null;
  /** Tool system (registry, waiters, execution) */
  tools: ToolRegistryContextValue;
  /** Prompt management */
  prompts: PromptsContextValue;
  /** Chat management */
  chat: ChatContextValue;
  /** Agent selection */
  agents: AgentContextValue;
  /** Command management */
  commands: CommandContextValue;
  /**
   * Aborts the in-flight run, if any. Persists the partial response and
   * leaves the conversation in a state where the user can send a follow-up.
   */
  abortRun: () => void;
}

/**
 * React context for UseAI provider state.
 * @internal Exported only for testing purposes. Use {@link useAIContext} instead.
 */
export const __UseAIContext = createContext<UseAIContextValue | null>(null);

/**
 * Flag to track if the "no provider" warning has been logged.
 * Prevents spamming the console with repeated warnings.
 */
let hasWarnedAboutMissingProvider = false;

/**
 * No-op context value returned when UseAIProvider is not present.
 * Allows hooks to gracefully degrade instead of crashing.
 */
const noOpContextValue: UseAIContextValue = {
  connected: false,
  client: null,
  tools: {
    register: () => {},
    unregister: () => {},
    signalReady: () => {},
    registerWaiter: () => {},
    unregisterWaiter: () => {},
  },
  prompts: {
    update: () => {},
  },
  chat: {
    currentId: null,
    create: async () => '',
    load: async () => {},
    delete: async () => {},
    list: async () => [],
    clear: async () => {},
    sendMessage: async () => {},
    get: async () => null,
    updateMetadata: async () => {},
  },
  agents: {
    available: [],
    default: null,
    selected: null,
    set: () => {},
  },
  commands: {
    list: [],
    refresh: async () => {},
    save: async () => '',
    rename: async () => {},
    delete: async () => {},
  },
  abortRun: () => {},
};

// ── Component Props ─────────────────────────────────────────────────────────

/**
 * Props for custom floating button component.
 * Used to customize the appearance and behavior of the AI chat trigger button.
 */
export interface FloatingButtonProps {
  /** Callback when the button is clicked */
  onClick: () => void;
  /** Whether the client is connected to the server */
  connected: boolean;
  /** Whether there are unread messages */
  hasUnread?: boolean;
}

/**
 * Props for custom chat panel component.
 * Used to customize the appearance and behavior of the AI chat interface.
 */
export interface ChatPanelProps {
  /** Whether the chat panel is open */
  isOpen: boolean;
  /** Callback when the panel should close */
  onClose: () => void;
  /** Callback when a message is sent */
  onSendMessage: (message: string) => void;
  /**
   * Aborts the in-flight run. No-op when no run is active.
   * Use this to wire a "stop" button while `loading` is true.
   */
  onAbort: () => void;
  /** Array of messages in the conversation */
  messages: PersistedMessage[];
  /** Whether the AI is currently processing */
  loading: boolean;
  /** Whether the client is connected to the server */
  connected: boolean;
  /** The in-flight answer split into ordered parts; empty between runs */
  streamingParts?: ChatStreamingPart[];
  /**
   * Id the streaming answer will be persisted under, or null between runs.
   * Render the in-flight answer under this id to let the persisted answer take
   * the same React key, so the bubble is updated instead of replaced and a
   * selection inside it survives.
   */
  streamingMessageId?: string | null;
  /** Optional array of suggestion strings to display when chat is empty */
  suggestions?: string[];
  /** List of available agents from the server */
  availableAgents?: AgentInfo[];
  /** The default agent ID from the server */
  defaultAgent?: string | null;
  /** The currently selected agent ID */
  selectedAgent?: string | null;
  /** Callback when agent is changed */
  onAgentChange?: (agentId: string | null) => void;
}

export type UseAIProviderProps = UseAIConfig & UseAIProviderOptions;

export interface UseAIProviderOptions {
  children: ReactNode;
  systemPrompt?: string;
  CustomButton?: React.ComponentType<FloatingButtonProps> | null;
  CustomChat?: React.ComponentType<ChatPanelProps> | null;
  /** Default component overrides for every built-in chat rendered by this provider. */
  chatComponents?: UseAIChatComponentOverrides;
  /**
   * Custom chat repository for message persistence.
   * Defaults to LocalStorageChatRepository if not provided.
   */
  chatRepository?: ChatRepository;
  /**
   * Provider function for forwarded props (telemetry metadata, MCP headers, etc.).
   * Called before each message is sent. Can be sync or async.
   * Props from this provider are merged with message-level forwardedProps,
   * with message-level taking precedence.
   *
   * @example
   * ```tsx
   * <UseAIProvider
   *   serverUrl="wss://your-server.com"
   *   forwardedPropsProvider={() => ({
   *     mcpHeaders: {
   *       // Exact match
   *       'https://api.example.com': {
   *         headers: { 'Authorization': `Bearer ${userToken}` }
   *       },
   *       // Wildcard subdomain
   *       'https://*.meetsmore.com': {
   *         headers: { 'X-API-Key': apiKey }
   *       },
   *       // Multiple wildcards
   *       '*://*.example.com': {
   *         headers: { 'X-Custom': 'value' }
   *       },
   *     },
   *     telemetryMetadata: {
   *       userId: currentUser.id,
   *       tenantId: tenant.id,
   *     },
   *   })}
   * >
   *   <App />
   * </UseAIProvider>
   * ```
   */
  forwardedPropsProvider?: () => UseAIForwardedProps | Promise<UseAIForwardedProps>;
  /**
   * Configuration for file uploads.
   * File upload is enabled by default with EmbedFileUploadBackend, 10MB max size,
   * and accepts images and PDFs.
   *
   * Set to `false` to disable file uploads.
   *
   * @default { backend: EmbedFileUploadBackend, maxFileSize: 10MB, acceptedTypes: ['image/*', 'application/pdf'] }
   *
   * @example
   * ```typescript
   * // Custom config
   * fileUploadConfig={{
   *   backend: new EmbedFileUploadBackend(),
   *   maxFileSize: 5 * 1024 * 1024, // 5MB
   *   acceptedTypes: ['image/*'],
   * }}
   *
   * // Disable file uploads
   * fileUploadConfig={false}
   * ```
   */
  fileUploadConfig?: FileUploadConfig | false;
  /**
   * Custom command repository for slash command persistence.
   * Defaults to LocalStorageCommandRepository if not provided.
   */
  commandRepository?: CommandRepository;
  /**
   * Opt-out toggles for optional chat UI features. Each feature defaults to
   * enabled, so only set a flag to false to hide it. For example, set
   * `{ slashCommands: false }` to hide the "save as slash command" UI while
   * keeping "/" autocomplete for existing saved commands.
   */
  enabledFeatures?: EnabledFeatures;
  /**
   * Whether to render the built-in chat UI (floating button + panel).
   * Set to false when using the `<UseAIChat>` component to control chat placement.
   * @default true
   */
  renderChat?: boolean;
  /**
   * Custom theme for all chat UI components.
   * Partial allows overriding only specific values.
   */
  theme?: Partial<UseAITheme>;
  /**
   * Custom strings for all chat UI components.
   * Useful for internationalization (i18n) or branding.
   * Partial allows overriding only specific strings.
   */
  strings?: Partial<UseAIStrings>;
  /**
   * List of agent IDs to show in the UI.
   * When provided, only agents with these IDs will be shown (if they exist on the server).
   *
   * @example
   * ```typescript
   * <UseAIProvider
   *   serverUrl="wss://your-server.com"
   *   visibleAgentIds={['claude-sonnet', 'claude-opus']}
   * >
   *   <App />
   * </UseAIProvider>
   * ```
   */
  visibleAgentIds?: AgentInfo['id'][];
  /**
   * Callback when the chat open state should change.
   * Called by programmatic actions like `sendMessage({ openChat: true })`.
   * Useful when `renderChat=false` and you control the chat panel's visibility externally.
   *
   * @example
   * ```tsx
   * const [sidebarOpen, setSidebarOpen] = useState(false);
   *
   * <UseAIProvider
   *   serverUrl="ws://localhost:8081"
   *   renderChat={false}
   *   onOpenChange={(isOpen) => {
   *     // Sync with external sidebar state
   *     setSidebarOpen(isOpen);
   *   }}
   * >
   *   <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
   *     <UseAIChat />
   *   </Sidebar>
   * </UseAIProvider>
   * ```
   */
  onOpenChange?: (isOpen: boolean) => void;
  /**
   * How the built-in chat panel should treat the Enter key.
   *
   * - `'enter'` (default): Enter submits, Shift+Enter inserts a newline.
   *   Typical desktop behavior.
   * - `'mod-enter'`: Enter inserts a newline. Cmd/Ctrl+Enter submits.
   *   Recommended for mobile/touch devices where soft keyboards lack modifier
   *   keys and the user is expected to tap the send button.
   *
   * Can be overridden per-instance via the `submitMode` prop on `<UseAIChat>`.
   *
   * @default 'enter'
   *
   * @example
   * ```tsx
   * import { isMobileApp } from '@/lib/is-mobile';
   *
   * <UseAIProvider
   *   serverUrl="wss://your-server.com"
   *   submitMode={isMobileApp() ? 'mod-enter' : 'enter'}
   * >
   *   <App />
   * </UseAIProvider>
   * ```
   */
  submitMode?: SubmitMode;
}

/**
 * Default file upload configuration.
 * - Backend: EmbedFileUploadBackend (base64 data URLs)
 * - Max size: 10MB
 * - Accepted types: images and PDFs
 */
const DEFAULT_FILE_UPLOAD_CONFIG: FileUploadConfig = {
  backend: new EmbedFileUploadBackend(),
  maxFileSize: 10 * 1024 * 1024, // 10MB
  acceptedTypes: ['image/*', 'application/pdf'],
};

// ── Provider Component ──────────────────────────────────────────────────────

/**
 * Provider component that manages AI client connection and tool registration.
 * Must wrap all components that use the useAI hook.
 *
 * Features:
 * - Establishes and maintains WebSocket connection to UseAI server
 * - Aggregates tools from all child useAI hooks
 * - Handles tool execution requests from the AI
 * - Provides floating button and chat panel UI
 *
 * @param props - Provider configuration and children
 *
 * @example
 * ```typescript
 * import { UseAIProvider } from '@meetsmore-oss/use-ai-client';
 *
 * function App() {
 *   return (
 *     <UseAIProvider
 *       serverUrl="wss://your-server.com"
 *       systemPrompt="You are a helpful assistant for managing todos"
 *     >
 *       <YourApp />
 *     </UseAIProvider>
 *   );
 * }
 * ```
 */
export function UseAIProvider({
  serverUrl,
  transport,
  children,
  systemPrompt,
  CustomButton,
  CustomChat,
  chatComponents,
  chatRepository,
  forwardedPropsProvider,
  fileUploadConfig: fileUploadConfigProp,
  commandRepository,
  enabledFeatures,
  renderChat = true,
  theme: customTheme,
  strings: customStrings,
  visibleAgentIds,
  onOpenChange,
  submitMode = 'enter',
}: UseAIProviderProps) {
  const fileUploadConfig = fileUploadConfigProp === false
    ? undefined
    : (fileUploadConfigProp ?? DEFAULT_FILE_UPLOAD_CONFIG);

  const theme = { ...defaultTheme, ...customTheme };
  const strings = { ...defaultStrings, ...customStrings };

  // ── Core State ──────────────────────────────────────────────────────────

  const [connected, setConnected] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState<PersistedMessage[]>([]);
  const [fileProcessingState, setFileProcessingState] = useState<FileProcessingState | null>(null);

  const handleSetChatOpen = useCallback((open: boolean) => {
    setIsChatOpen(open);
    onOpenChange?.(open);
  }, [onOpenChange]);

  const clientRef = useRef<UseAIClient | null>(null);
  const repositoryRef = useRef<ChatRepository>(
    chatRepository || new LocalStorageChatRepository()
  );

  // ── Hooks ───────────────────────────────────────────────────────────────

  const promptState = usePromptState({
    systemPrompt,
    clientRef,
    connected,
  });

  const toolSystem = useToolSystem({
    clientRef,
    buildState: promptState.buildStateFromPrompts,
  });

  const chatManagement = useChatManagement({
    repository: repositoryRef.current,
    clientRef,
    messages,
    setMessages,
    connected,
  });

  const serverEvents = useServerEvents({
    toolSystem,
    saveAIResponse: chatManagement.saveAIResponse,
    strings,
  });

  const feedback = useFeedback({
    clientRef,
    repository: repositoryRef.current,
    getDisplayedChatId: () => chatManagement.displayedChatId,
    setMessages,
  });

  const {
    availableAgents,
    defaultAgent,
    selectedAgent,
    setAgent,
  } = useAgentSelection({ clientRef, connected, visibleAgentIds });

  const {
    commands,
    refreshCommands,
    saveCommand,
    renameCommand,
    deleteCommand,
  } = useCommandManagement({ repository: commandRepository });

  // ── Client Lifecycle ────────────────────────────────────────────────────

  // Ref to always call the latest handleServerEvent from the stable subscription
  const handleServerEventRef = useRef(serverEvents.handleServerEvent);
  handleServerEventRef.current = serverEvents.handleServerEvent;

  // Same pattern for handleDisconnect: the connection subscription is set up
  // once per client lifecycle, but the handler closes over state that may
  // change between renders.
  const handleDisconnectRef = useRef(serverEvents.handleDisconnect);
  handleDisconnectRef.current = serverEvents.handleDisconnect;

  // Read once: an inline `transport` object would otherwise re-create the client
  // on every render.
  const transportRef = useRef(transport);

  useEffect(() => {
    const target = transportRef.current ?? serverUrl!;
    console.log('[UseAIProvider] Initializing client with', typeof target === 'string' ? target : 'transport');
    const client = new UseAIClient(target);

    const unsubscribeConnection = client.onConnectionStateChange((isConnected) => {
      console.log('[UseAIProvider] Connection state changed:', isConnected);
      setConnected(isConnected);
      if (!isConnected) {
        // The server destroys its session on disconnect (keyed by connection id),
        // so any in-flight run is unrecoverable even after the transport reconnects.
        // Reset UI state so the user can send a new message instead of being
        // stuck in a permanent "loading" state.
        handleDisconnectRef.current();
      }
    });

    console.log('[UseAIProvider] Connecting...');
    client.connect();

    const unsubscribe = client.onEvent('globalChat', async (event: AGUIEvent) => {
      await handleServerEventRef.current(client, event);
    });

    clientRef.current = client;

    return () => {
      unsubscribeConnection();
      unsubscribe();
      client.disconnect();
    };
  }, [serverUrl]);

  // ── Tool Registration Sync ──────────────────────────────────────────────

  const lastRegisteredToolsRef = useRef<string>('');

  useEffect(() => {
    const client = clientRef.current;
    if (!client || !client.isConnected()) return;

    if (!toolSystem.hasTools) {
      // All tools were unregistered (e.g., page navigation).
      // Clear stale tools from the client instance.
      if (lastRegisteredToolsRef.current !== '') {
        lastRegisteredToolsRef.current = '';
        client.registerTools([]);
        console.log('[Provider] All tools unregistered, clearing client tools');
      }
      return;
    }

    const toolKeys = Object.keys(toolSystem.aggregatedTools).sort().join(',');
    if (toolKeys === lastRegisteredToolsRef.current) {
      console.log('[Provider] Skipping re-registration, tools unchanged');
      return;
    }

    lastRegisteredToolsRef.current = toolKeys;
    console.log('[Provider] Registering tools:', toolKeys);

    try {
      const toolDefinitions = convertToolsToDefinitions(toolSystem.aggregatedTools);
      console.log(`[Provider] Registering ${toolDefinitions.length} tools`);
      client.registerTools(toolDefinitions);
    } catch (err) {
      console.error('Failed to register tools:', err);
    }
  }, [toolSystem.hasTools, toolSystem.aggregatedTools, connected]);

  // ── Abort ───────────────────────────────────────────────────────────────

  const abortRun = useCallback(() => {
    clientRef.current?.abortRun();
  }, []);

  // ── Message Sending ─────────────────────────────────────────────────────

  const handleSendMessage = useCallback(async (message: string, attachments?: FileAttachment[], messageForwardedProps?: UseAIForwardedProps) => {
    if (!clientRef.current) return;

    serverEvents.clearStreamingParts();

    const activatedChatId = chatManagement.activatePendingChat();
    const activeChatId = activatedChatId || chatManagement.currentChatId;

    serverEvents.streamingChatIdRef.current = activeChatId;

    let persistedContent: PersistedMessageContent = message;
    let multimodalContent: MultimodalContent[] | undefined;

    if (attachments && attachments.length > 0) {
      serverEvents.setLoading(true);

      let fileContent: MultimodalContent[];
      try {
        fileContent = await processAttachments(attachments, {
          getCurrentChat: chatManagement.getCurrentChat,
          backend: fileUploadConfig?.backend,
          transformers: fileUploadConfig?.transformers,
          onFileProgress: (_fileId, state) => {
            setFileProcessingState(state);
          },
        });
      } catch (error) {
        serverEvents.setLoading(false);
        throw error;
      } finally {
        setFileProcessingState(null);
      }

      // Persist the transformed text alongside attachment metadata so the
      // full context survives a localStorage rehydration. See
      // docs/plans/bugfix-transformed-file-persistence.md.
      persistedContent = buildPersistedParts(message, attachments, fileContent);

      if (activeChatId) {
        await chatManagement.saveUserMessage(activeChatId, persistedContent);
      }

      multimodalContent = [];
      if (message.trim()) {
        multimodalContent.push({ type: 'text', text: message });
      }
      multimodalContent.push(...fileContent);
    } else {
      if (activeChatId) {
        await chatManagement.saveUserMessage(activeChatId, persistedContent);
      }
      serverEvents.setLoading(true);
    }

    const providerResult = forwardedPropsProvider ? forwardedPropsProvider() : {};
    const providerProps = providerResult instanceof Promise ? await providerResult : providerResult;

    const mergedForwardedProps = {
      ...providerProps,
      ...messageForwardedProps,
    };

    await clientRef.current.sendPrompt(
      message,
      multimodalContent,
      Object.keys(mergedForwardedProps).length > 0
        ? mergedForwardedProps
        : undefined
    );
  }, [chatManagement, serverEvents, fileUploadConfig, forwardedPropsProvider]);

  // ── Message Queue (programmatic sendMessage) ────────────────────────────

  const messageQueue = useMessageQueue({
    sendFn: handleSendMessage,
    createNewChat: chatManagement.createNewChat,
    setOpen: handleSetChatOpen,
    connected,
    loading: serverEvents.loading,
    hasPendingApproval: toolSystem.pendingApprovals.length > 0,
  });

  // ── Context Values ──────────────────────────────────────────────────────

  const value: UseAIContextValue = {
    serverUrl,
    connected,
    client: clientRef.current,
    tools: {
      register: toolSystem.registerTools,
      unregister: toolSystem.unregisterTools,
      signalReady: toolSystem.signalReady,
      registerWaiter: toolSystem.registerWaiter,
      unregisterWaiter: toolSystem.unregisterWaiter,
    },
    prompts: {
      update: promptState.updatePrompt,
    },
    chat: {
      currentId: chatManagement.currentChatId,
      create: chatManagement.createNewChat,
      load: chatManagement.loadChat,
      delete: chatManagement.deleteChat,
      list: chatManagement.listChats,
      clear: chatManagement.clearCurrentChat,
      sendMessage: messageQueue.sendMessage,
      get: chatManagement.getCurrentChat,
      updateMetadata: chatManagement.updateMetadata,
    },
    agents: {
      available: availableAgents,
      default: defaultAgent,
      selected: selectedAgent,
      set: setAgent,
    },
    commands: {
      list: commands,
      refresh: refreshCommands,
      save: saveCommand,
      rename: renameCommand,
      delete: deleteCommand,
    },
    abortRun,
  };

  // ── Chat UI ─────────────────────────────────────────────────────────────

  const effectiveStreamingMessageId = serverEvents.streamingChatIdRef.current === chatManagement.displayedChatId
    ? serverEvents.streamingMessageId : null;
  const effectiveStreamingParts = serverEvents.streamingChatIdRef.current === chatManagement.displayedChatId
    ? serverEvents.streamingParts : EMPTY_STREAMING_PARTS;

  const chatUIContextValue: ChatUIContextValue = {
    connected,
    loading: serverEvents.loading,
    sendMessage: handleSendMessage,
    abortRun,
    messages,
    streamingMessageId: effectiveStreamingMessageId,
    streamingParts: effectiveStreamingParts,
    suggestions: promptState.aggregatedSuggestions,
    fileUploadConfig,
    fileProcessing: fileProcessingState,
    history: {
      currentId: chatManagement.displayedChatId,
      create: chatManagement.createNewChat,
      load: chatManagement.loadChat,
      delete: chatManagement.deleteChat,
      list: chatManagement.listChats,
      get: chatManagement.getCurrentChat,
    },
    agents: {
      available: availableAgents,
      default: defaultAgent,
      selected: selectedAgent,
      set: setAgent,
    },
    commands: {
      list: commands,
      save: saveCommand,
      rename: renameCommand,
      delete: deleteCommand,
    },
    enabledFeatures,
    ui: {
      isOpen: isChatOpen,
      setOpen: handleSetChatOpen,
    },
    tools: {
      executing: serverEvents.executingTool,
      pending: {
        tools: toolSystem.pendingApprovals,
        approveAll: toolSystem.approveAll,
        rejectAll: toolSystem.rejectAll,
      },
    },
    feedback: {
      enabled: feedback.enabled,
      submit: feedback.submitFeedback,
    },
    submitMode,
    components: chatComponents,
  };

  const isUIDisabled = CustomButton === null || CustomChat === null;
  const ButtonComponent = isUIDisabled ? null : (CustomButton || UseAIFloatingButton);
  const hasCustomChat = CustomChat !== undefined && CustomChat !== null;

  const chatPanelProps = {
    onSendMessage: handleSendMessage,
    onAbort: abortRun,
    messages,
    loading: serverEvents.loading,
    connected,
    streamingMessageId: effectiveStreamingMessageId,
    streamingParts: effectiveStreamingParts,
    currentChatId: chatManagement.displayedChatId,
    onNewChat: chatManagement.createNewChat,
    onLoadChat: chatManagement.loadChat,
    onDeleteChat: chatManagement.deleteChat,
    onListChats: chatManagement.listChats,
    suggestions: promptState.aggregatedSuggestions,
    availableAgents,
    defaultAgent,
    selectedAgent,
    onAgentChange: setAgent,
    fileUploadConfig,
    fileProcessing: fileProcessingState,
    commands,
    onSaveCommand: saveCommand,
    enabledFeatures,
    onRenameCommand: renameCommand,
    onDeleteCommand: deleteCommand,
    executingTool: serverEvents.executingTool,
    feedbackEnabled: feedback.enabled,
    onFeedback: feedback.submitFeedback,
    pendingApprovals: toolSystem.pendingApprovals,
    onApproveToolCall: toolSystem.pendingApprovals.length > 0 ? toolSystem.approveAll : undefined,
    onRejectToolCall: toolSystem.pendingApprovals.length > 0 ? toolSystem.rejectAll : undefined,
    submitMode,
    components: chatComponents,
  };

  const renderDefaultChat = () => {
    if (isUIDisabled) return null;
    return (
      <UseAIFloatingChatWrapper isOpen={isChatOpen} onClose={() => handleSetChatOpen(false)}>
        <UseAIChatPanel
          {...chatPanelProps}
          closeButton={<CloseButton onClick={() => handleSetChatOpen(false)} />}
        />
      </UseAIFloatingChatWrapper>
    );
  };

  const renderCustomChat = () => {
    if (!CustomChat) return null;
    return (
      <CustomChat
        isOpen={isChatOpen}
        onClose={() => handleSetChatOpen(false)}
        onSendMessage={handleSendMessage}
        onAbort={abortRun}
        messages={messages}
        loading={serverEvents.loading}
        connected={connected}
        streamingParts={effectiveStreamingParts}
        streamingMessageId={effectiveStreamingMessageId}
        suggestions={promptState.aggregatedSuggestions}
        availableAgents={availableAgents}
        defaultAgent={defaultAgent}
        selectedAgent={selectedAgent}
        onAgentChange={setAgent}
      />
    );
  };

  const renderBuiltInChat = () => {
    if (!renderChat) return null;
    return (
      <>
        {ButtonComponent && (
          <ButtonComponent
            onClick={() => handleSetChatOpen(true)}
            connected={connected}
          />
        )}
        {hasCustomChat ? renderCustomChat() : renderDefaultChat()}
      </>
    );
  };

  return (
    <ThemeContext.Provider value={theme}>
      <StringsContext.Provider value={strings}>
        <__UseAIContext.Provider value={value}>
          <__UseAIChatContext.Provider value={chatUIContextValue}>
            {children}
            {renderBuiltInChat()}
          </__UseAIChatContext.Provider>
        </__UseAIContext.Provider>
      </StringsContext.Provider>
    </ThemeContext.Provider>
  );
}

// ── Context Hook ────────────────────────────────────────────────────────────

/**
 * Hook to access the UseAI context.
 * When used outside a UseAIProvider, returns a no-op context and logs a warning.
 */
export function useAIContext(): UseAIContextValue {
  const context = useContext(__UseAIContext);
  if (!context) {
    if (!hasWarnedAboutMissingProvider) {
      console.warn(
        '[use-ai] useAI hook used without UseAIProvider. AI features will be disabled. ' +
        'Wrap your app in <UseAIProvider> to enable AI features.'
      );
      hasWarnedAboutMissingProvider = true;
    }
    return noOpContextValue;
  }
  return context;
}
