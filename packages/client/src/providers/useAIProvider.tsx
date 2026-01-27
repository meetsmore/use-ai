import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import type { UseAIConfig, AGUIEvent, ToolCallEndEvent, RunErrorEvent, RunFinishedEvent, AgentInfo, TextMessageContentEvent } from '../types';
import { EventType, ErrorCode } from '../types';
import { UseAIFloatingButton } from '../components/UseAIFloatingButton';
import { UseAIChatPanel, type Message } from '../components/UseAIChatPanel';
import { UseAIFloatingChatWrapper, CloseButton } from '../components/UseAIFloatingChatWrapper';
import { __UseAIChatContext, type ChatUIContextValue } from '../components/UseAIChat';
import { UseAIClient } from '../client';
import { convertToolsToDefinitions, executeDefinedTool, type ToolsDefinition } from '../defineTool';
import type { ChatRepository, Chat, ChatMetadata, CreateChatOptions, PersistedMessageContent, PersistedContentPart } from './chatRepository/types';
import { LocalStorageChatRepository } from './chatRepository/LocalStorageChatRepository';
import type { FileAttachment, FileUploadConfig } from '../fileUpload/types';
import { processAttachments } from '../fileUpload/processAttachments';
import { EmbedFileUploadBackend } from '../fileUpload/EmbedFileUploadBackend';
import type { MultimodalContent } from '@meetsmore-oss/use-ai-core';
import type { CommandRepository, SavedCommand } from '../commands/types';
import { useChatManagement, type SendMessageOptions } from '../hooks/useChatManagement';
import { useAgentSelection } from '../hooks/useAgentSelection';
import { useCommandManagement } from '../hooks/useCommandManagement';
import { useToolRegistry } from '../hooks/useToolRegistry';
import { usePromptState } from '../hooks/usePromptState';
import { useFeedback } from '../hooks/useFeedback';
import { ThemeContext, StringsContext, defaultTheme, defaultStrings } from '../theme';
import type { UseAITheme, UseAIStrings } from '../theme';

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
 * Tool registry context (from useToolRegistry hook).
 */
export interface ToolRegistryContextValue {
  /** Registers tools for a specific component */
  register: (id: string, tools: ToolsDefinition, options?: { invisible?: boolean }) => void;
  /** Unregisters tools for a specific component */
  unregister: (id: string) => void;
}

/**
 * Prompt management context.
 */
export interface PromptsContextValue {
  /** Updates the prompt and suggestions for a specific component */
  update: (id: string, prompt?: string, suggestions?: string[]) => void;
  /** Registers a waiter function for a component */
  registerWaiter: (id: string, waiter: () => Promise<void>) => void;
  /** Unregisters a waiter function */
  unregisterWaiter: (id: string) => void;
}

/**
 * Context value provided by UseAIProvider.
 * Contains connection state and methods for managing tools and prompts.
 */
export interface UseAIContextValue {
  /** The WebSocket URL of the UseAI server */
  serverUrl: string;
  /** Whether the client is connected to the server */
  connected: boolean;
  /** The underlying WebSocket client instance */
  client: UseAIClient | null;
  /** Tool registry (from useToolRegistry hook) */
  tools: ToolRegistryContextValue;
  /** Prompt management */
  prompts: PromptsContextValue;
  /** Chat management (from useChatManagement hook) */
  chat: ChatContextValue;
  /** Agent selection (from useAgentSelection hook) */
  agents: AgentContextValue;
  /** Command management (from useCommandManagement hook) */
  commands: CommandContextValue;
}

/**
 * React context for UseAI provider state.
 * @internal This is exported only for testing purposes and should not be used directly.
 * Use the {@link useAIContext} hook instead.
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
  serverUrl: '',
  connected: false,
  client: null,
  tools: {
    register: () => {},
    unregister: () => {},
  },
  prompts: {
    update: () => {},
    registerWaiter: () => {},
    unregisterWaiter: () => {},
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
};

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
  /** Array of messages in the conversation */
  messages: Message[];
  /** Whether the AI is currently processing */
  loading: boolean;
  /** Whether the client is connected to the server */
  connected: boolean;
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

export interface UseAIProviderProps extends UseAIConfig {
  children: ReactNode;
  systemPrompt?: string;
  CustomButton?: React.ComponentType<FloatingButtonProps> | null;
  CustomChat?: React.ComponentType<ChatPanelProps> | null;
  /**
   * Custom chat repository for message persistence.
   * Defaults to LocalStorageChatRepository if not provided.
   */
  chatRepository?: ChatRepository;
  /**
   * Callback to provide HTTP headers for MCP endpoints.
   * Called each time AI is invoked by use-ai.
   * Returns a mapping of MCP endpoint patterns to header configurations.
   *
   * Patterns can be:
   * - Constant strings: `https://api.example.com` - Exact match
   * - Glob patterns: `https://*.meetsmore.com` - Wildcard matching using picomatch
   *
   * @example
   * ```typescript
   * mcpHeadersProvider={() => ({
   *   // Exact match
   *   'https://api.example.com': {
   *     headers: { 'Authorization': `Bearer ${userToken}` }
   *   },
   *   // Wildcard subdomain
   *   'https://*.meetsmore.com': {
   *     headers: { 'X-API-Key': apiKey }
   *   },
   *   // Multiple wildcards
   *   '*://*.example.com': {
   *     headers: { 'X-Custom': 'value' }
   *   }
   * })}
   * ```
   */
  mcpHeadersProvider?: () => import('@meetsmore-oss/use-ai-core').McpHeadersMap | Promise<import('@meetsmore-oss/use-ai-core').McpHeadersMap>;
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
  children,
  systemPrompt,
  CustomButton,
  CustomChat,
  chatRepository,
  mcpHeadersProvider,
  fileUploadConfig: fileUploadConfigProp,
  commandRepository,
  renderChat = true,
  theme: customTheme,
  strings: customStrings,
  visibleAgentIds,
  onOpenChange,
}: UseAIProviderProps) {
  // Compute effective file upload config: use default if undefined, disable if false
  const fileUploadConfig = fileUploadConfigProp === false
    ? undefined
    : (fileUploadConfigProp ?? DEFAULT_FILE_UPLOAD_CONFIG);

  // Merge custom theme/strings with defaults
  const theme = { ...defaultTheme, ...customTheme };
  const strings = { ...defaultStrings, ...customStrings };

  const [connected, setConnected] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  // Wrapper for setIsChatOpen that also calls onOpenChange callback
  const handleSetChatOpen = useCallback((open: boolean) => {
    setIsChatOpen(open);
    onOpenChange?.(open);
  }, [onOpenChange]);
  const [streamingText, setStreamingText] = useState('');
  // Track which chat the current streaming text belongs to
  const streamingChatIdRef = useRef<string | null>(null);

  const clientRef = useRef<UseAIClient | null>(null);
  const repositoryRef = useRef<ChatRepository>(
    chatRepository || new LocalStorageChatRepository()
  );

  // Ref for handleSendMessage to break circular dependency with useChatManagement
  const handleSendMessageRef = useRef<((message: string, attachments?: FileAttachment[]) => Promise<void>) | null>(null);

  // Initialize tool registry hook
  const {
    registerTools,
    unregisterTools,
    isInvisible,
    aggregatedTools,
    hasTools,
    aggregatedToolsRef,
    toolOwnershipRef,
  } = useToolRegistry();

  // Initialize prompt state hook
  const {
    updatePrompt,
    registerWaiter,
    unregisterWaiter,
    getWaiter,
    aggregatedSuggestions,
    promptsRef,
  } = usePromptState({
    systemPrompt,
    clientRef,
    connected,
  });

  // Stable callback that uses the ref (for useChatManagement)
  const stableSendMessage = useCallback(async (message: string, attachments?: FileAttachment[]) => {
    if (handleSendMessageRef.current) {
      await handleSendMessageRef.current(message, attachments);
    }
  }, []);

  // Initialize chat management hook
  const chatManagement = useChatManagement({
    repository: repositoryRef.current,
    clientRef,
    messages,
    setMessages,
    onSendMessage: stableSendMessage,
    setOpen: handleSetChatOpen,
    connected,
    loading,
  });

  const {
    currentChatId,
    pendingChatId,
    displayedChatId,
    createNewChat,
    loadChat,
    deleteChat,
    listChats,
    clearCurrentChat,
    activatePendingChat,
    saveUserMessage,
    saveAIResponse,
    sendMessage,
    getCurrentChat,
    updateMetadata,
  } = chatManagement;

  // Initialize feedback hook
  const feedback = useFeedback({
    clientRef,
    repository: repositoryRef.current,
    getDisplayedChatId: () => displayedChatId,
    setMessages,
  });

  // Initialize agent selection hook
  const {
    availableAgents,
    defaultAgent,
    selectedAgent,
    setAgent,
  } = useAgentSelection({ clientRef, connected, visibleAgentIds });

  // Initialize command management hook
  const {
    commands,
    refreshCommands,
    saveCommand,
    renameCommand,
    deleteCommand,
  } = useCommandManagement({ repository: commandRepository });

  useEffect(() => {
    console.log('[UseAIProvider] Initializing client with serverUrl:', serverUrl);
    const client = new UseAIClient(serverUrl);

    // Set MCP headers provider if provided
    if (mcpHeadersProvider) {
      client.setMcpHeadersProvider(mcpHeadersProvider);
    }

    // Subscribe to connection state changes (handles initial connection, reconnection, and disconnection)
    const unsubscribeConnection = client.onConnectionStateChange((isConnected) => {
      console.log('[UseAIProvider] Connection state changed:', isConnected);
      setConnected(isConnected);
    });

    console.log('[UseAIProvider] Connecting...');
    client.connect();

    const unsubscribe = client.onEvent('globalChat', async (event: AGUIEvent) => {
      if (event.type === EventType.TOOL_CALL_END) {
        const toolCallEnd = event as ToolCallEndEvent;
        const toolCallId = toolCallEnd.toolCallId;

        // Get the accumulated tool call data
        const toolCallData = client['currentToolCalls'].get(toolCallId);
        if (!toolCallData) {
          console.error(`[Provider] Tool call ${toolCallId} not found`);
          return;
        }

        const name = toolCallData.name;
        const input = JSON.parse(toolCallData.args);

        // Check if this tool belongs to a useAI hook (not a workflow)
        // If the tool doesn't exist in our aggregated tools, it's a workflow tool
        // and will be handled by useAIWorkflow's event listener
        if (!aggregatedToolsRef.current[name]) {
          console.log(`[Provider] Tool "${name}" not found in useAI tools, skipping (likely a workflow tool)`);
          return;
        }

        try {
          const ownerId = toolOwnershipRef.current.get(name);
          console.log(`[useAI] Tool "${name}" owned by component:`, ownerId);

          console.log('[useAI] Executing tool...');
          const result = await executeDefinedTool(aggregatedToolsRef.current, name, input);

          // Check if result indicates an error - if so, skip waiting for prompt change
          // Error results typically don't trigger state changes
          const isErrorResult = result && typeof result === 'object' &&
            ('error' in result || (result as Record<string, unknown>).success === false);

          // Check if component is invisible (no visual state to wait for)
          const ownerIsInvisible = ownerId ? isInvisible(ownerId) : false;

          // Wait for prompt to update (via waiter registered by useAI) unless it's an error or invisible
          if (ownerId && !isErrorResult && !ownerIsInvisible) {
            const waiter = getWaiter(ownerId);
            if (waiter) {
              console.log(`[useAI] Waiting for prompt change from ${ownerId}...`);
              await waiter();
              console.log('[useAI] Prompt change wait complete');
            }
          } else if (isErrorResult) {
            console.log('[useAI] Tool returned error, skipping prompt wait');
          } else if (ownerIsInvisible) {
            console.log('[useAI] Component is invisible, skipping prompt wait');
          }

          // Build updated state
          let updatedState: unknown = null;
          if (ownerId) {
            const prompt = promptsRef.current.get(ownerId);
            if (prompt) {
              updatedState = { context: prompt };
              console.log(`[useAI] Updated state from ${ownerId}`);
            }
          }

          client.sendToolResponse(toolCallId, result, updatedState);
        } catch (err) {
          console.error('Tool execution error:', err);
          client.sendToolResponse(toolCallId, {
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      } else if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
        // Update streaming text in real-time for UI display
        const contentEvent = event as TextMessageContentEvent;
        setStreamingText(prev => prev + contentEvent.delta);
      } else if (event.type === EventType.TEXT_MESSAGE_END) {
        // Content will be saved on RUN_FINISHED to include traceId
        // Just clear streaming UI state here
        setStreamingText('');
        streamingChatIdRef.current = null;
      } else if (event.type === EventType.RUN_FINISHED) {
        const content = client.currentMessageContent;
        if (content) {
          // Extract traceId directly from the event (runId is the trace ID)
          const finishedEvent = event as RunFinishedEvent;
          const traceId = finishedEvent.runId;
          saveAIResponse(content, undefined, traceId);
        }
        setLoading(false);
      } else if (event.type === EventType.RUN_ERROR) {
        const errorEvent = event as RunErrorEvent;
        const errorCode = errorEvent.message as ErrorCode;
        console.error('[Provider] Run error:', errorCode);

        // Get error message from strings (customizable via strings prop)
        const userMessage = strings.errors[errorCode] || strings.errors[ErrorCode.UNKNOWN_ERROR];

        // Display error message in chat UI with error styling
        saveAIResponse(userMessage, 'error'); // Fire-and-forget is intentional here
        setStreamingText(''); // Clear any partial streaming text
        streamingChatIdRef.current = null; // Clear streaming chat association

        setLoading(false);
      }
    });

    clientRef.current = client;

    return () => {
      unsubscribeConnection();
      unsubscribe();
      client.disconnect();
    };
  }, [serverUrl]);

  // Update MCP headers provider when it changes
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    if (mcpHeadersProvider) {
      client.setMcpHeadersProvider(mcpHeadersProvider);
    }
  }, [mcpHeadersProvider]);

  const lastRegisteredToolsRef = useRef<string>('');

  useEffect(() => {
    const client = clientRef.current;
    if (!client || !client.isConnected() || !hasTools) return;

    const toolKeys = Object.keys(aggregatedTools).sort().join(',');
    if (toolKeys === lastRegisteredToolsRef.current) {
      console.log('[Provider] Skipping re-registration, tools unchanged');
      return;
    }

    lastRegisteredToolsRef.current = toolKeys;
    console.log('[Provider] Registering tools:', toolKeys);

    try {
      const toolDefinitions = convertToolsToDefinitions(aggregatedTools);
      console.log(`[Provider] Registering ${toolDefinitions.length} tools`);
      // Only register tools here - state is updated separately via updatePrompt
      client.registerTools(toolDefinitions);
    } catch (err) {
      console.error('Failed to register tools:', err);
    }
  }, [hasTools, aggregatedTools, connected]);

  const handleSendMessage = useCallback(async (message: string, attachments?: FileAttachment[]) => {
    if (!clientRef.current) return;

    // Clear any previous streaming text when starting a new message
    setStreamingText('');

    // Activate pending chat if exists (user is sending first message to it)
    const activatedChatId = activatePendingChat();
    const activeChatId = activatedChatId || currentChatId;

    // Track which chat this streaming response belongs to
    streamingChatIdRef.current = activeChatId;

    // Build content for storage and sending
    let persistedContent: PersistedMessageContent = message;
    let multimodalContent: MultimodalContent[] | undefined;

    if (attachments && attachments.length > 0) {
      // Build persisted content (metadata only) for storage
      const persistedParts: PersistedContentPart[] = [];
      if (message.trim()) {
        persistedParts.push({ type: 'text', text: message });
      }
      for (const attachment of attachments) {
        persistedParts.push({
          type: 'file',
          file: {
            name: attachment.file.name,
            size: attachment.file.size,
            mimeType: attachment.file.type,
          },
        });
      }
      persistedContent = persistedParts;

      // Build multimodal content from attachments
      const fileContent = await processAttachments(attachments, {
        getCurrentChat,
        backend: fileUploadConfig?.backend,
        transformers: fileUploadConfig?.transformers,
      });

      multimodalContent = [];
      if (message.trim()) {
        multimodalContent.push({ type: 'text', text: message });
      }
      multimodalContent.push(...fileContent);
    }

    // Save user message to storage
    if (activeChatId) {
      await saveUserMessage(activeChatId, persistedContent);
    }

    // State is already up-to-date via updatePrompt calls from useAI hooks
    setLoading(true);
    await clientRef.current.sendPrompt(message, multimodalContent);
  }, [activatePendingChat, currentChatId, saveUserMessage, fileUploadConfig, getCurrentChat]);

  // Update the ref so useChatManagement's sendMessage can use it
  handleSendMessageRef.current = handleSendMessage;

  const value: UseAIContextValue = {
    serverUrl,
    connected,
    client: clientRef.current,
    tools: {
      register: registerTools,
      unregister: unregisterTools,
    },
    prompts: {
      update: updatePrompt,
      registerWaiter,
      unregisterWaiter,
    },
    chat: {
      currentId: currentChatId,
      create: createNewChat,
      load: loadChat,
      delete: deleteChat,
      list: listChats,
      clear: clearCurrentChat,
      sendMessage,
      get: getCurrentChat,
      updateMetadata,
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
  };

  // Only show streaming text if it belongs to the currently displayed chat
  // This prevents streaming from a previous chat appearing when switching chats
  const effectiveStreamingText = streamingChatIdRef.current === displayedChatId ? streamingText : '';

  // Chat UI context value - used by UseAIChat component
  const chatUIContextValue: ChatUIContextValue = {
    connected,
    loading,
    sendMessage: handleSendMessage,
    messages,
    streamingText: effectiveStreamingText,
    suggestions: aggregatedSuggestions,
    fileUploadConfig,
    history: {
      currentId: displayedChatId,
      create: createNewChat,
      load: loadChat,
      delete: deleteChat,
      list: listChats,
      get: getCurrentChat,
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
    ui: {
      isOpen: isChatOpen,
      setOpen: handleSetChatOpen,
    },
    feedback: {
      enabled: feedback.enabled,
      submit: feedback.submitFeedback,
    },
  };

  // Use custom components if provided, or defaults (unless explicitly null to disable UI)
  // When either component is explicitly null, disable the UI entirely
  const isUIDisabled = CustomButton === null || CustomChat === null;
  const ButtonComponent = isUIDisabled ? null : (CustomButton || UseAIFloatingButton);
  const hasCustomChat = CustomChat !== undefined && CustomChat !== null;

  // Common props for the chat panel
  const chatPanelProps = {
    onSendMessage: handleSendMessage,
    messages,
    loading,
    connected,
    streamingText: effectiveStreamingText,
    currentChatId: displayedChatId,
    onNewChat: createNewChat,
    onLoadChat: loadChat,
    onDeleteChat: deleteChat,
    onListChats: listChats,
    suggestions: aggregatedSuggestions,
    availableAgents,
    defaultAgent,
    selectedAgent,
    onAgentChange: setAgent,
    fileUploadConfig,
    commands,
    onSaveCommand: saveCommand,
    onRenameCommand: renameCommand,
    onDeleteCommand: deleteCommand,
    feedbackEnabled: feedback.enabled,
    onFeedback: feedback.submitFeedback,
  };

  // Render function for default floating chat UI
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

  // Render function for custom chat UI (backward compatibility)
  const renderCustomChat = () => {
    if (!CustomChat) return null;

    return (
      <CustomChat
        isOpen={isChatOpen}
        onClose={() => handleSetChatOpen(false)}
        onSendMessage={handleSendMessage}
        messages={messages}
        loading={loading}
        connected={connected}
        suggestions={aggregatedSuggestions}
        availableAgents={availableAgents}
        defaultAgent={defaultAgent}
        selectedAgent={selectedAgent}
        onAgentChange={setAgent}
      />
    );
  };

  // Render built-in chat UI only when renderChat is true
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

/**
 * Hook to access the UseAI context.
 * When used outside a UseAIProvider, returns a no-op context and logs a warning.
 * This allows components with useAI hooks to render even when UseAIProvider
 * is conditionally not rendered (e.g., feature flagged).
 *
 * @returns The UseAI context value (or no-op if provider is missing)
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const { connected, client } = useAIContext();
 *   return <div>Connected: {connected}</div>;
 * }
 * ```
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
