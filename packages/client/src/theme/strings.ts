import { createContext, useContext } from "react";

/**
 * Default text labels for the chat UI.
 * Use for internationalization (i18n) or branding.
 */
export const defaultStrings = {
  // Chat panel header
  header: {
    /** Header title when no chat history feature */
    aiAssistant: 'AI Assistant',
    /** Label for new chat button tooltip */
    newChat: 'New Chat',
    /** Delete chat confirmation message */
    deleteConfirm: 'Delete this chat from history?',
    /** Delete button tooltip */
    deleteChat: 'Delete Chat',
    /** Connection status: online */
    online: 'Online',
    /** Connection status: offline */
    offline: 'Offline',
  },

  // Chat history dropdown
  chatHistory: {
    /** Chat history: no chats message */
    noChatHistory: 'No chat history yet',
    /** Chat history: active chat indicator */
    active: 'Active',
  },

  // Empty chat state
  emptyChat: {
    /** Empty chat welcome message */
    startConversation: 'Start a conversation with the AI assistant',
    /** Empty chat help text */
    askMeToHelp: 'Ask me to help with your tasks!',
  },

  // Chat input
  input: {
    /** Input placeholder when connected */
    placeholder: 'Type a message...',
    /** Input placeholder when connecting */
    connectingPlaceholder: 'Connecting...',
    /** Loading indicator text */
    thinking: 'Thinking',
  },

  // File upload
  fileUpload: {
    /** Attach files button tooltip */
    attachFiles: 'Attach Files',
    /** Drop zone text when dragging files */
    dropFilesHere: 'Drop files here',
    /** File size error (use {filename} and {maxSize} placeholders) */
    fileSizeError: 'File "{filename}" exceeds {maxSize}MB limit',
    /** File type error (use {type} placeholder) */
    fileTypeError: 'File type "{type}" is not accepted',
  },

  // Floating button
  floatingButton: {
    /** Floating button title when connected */
    openAssistant: 'Open AI Assistant',
    /** Floating button title when connecting */
    connectingToAssistant: 'Connecting to AI...',
  },

  // Slash commands
  commands: {
    /** No saved commands empty state */
    noSavedCommands: 'No saved commands yet',
    /** No matching commands message */
    noMatchingCommands: 'No matching commands',
    /** Delete command button tooltip */
    deleteCommand: 'Delete command',
    /** Command name input placeholder */
    commandNamePlaceholder: 'command-name',
    /** Save command button tooltip */
    saveCommand: 'Save command',
    /** Error when command name already exists */
    commandNameExists: 'Command name already exists',
    /** Error when rename is not supported */
    renameNotSupported: 'Rename not supported',
    /** Error when save is not supported */
    saveNotSupported: 'Save not supported',
    /** Error when rename fails */
    renameFailed: 'Failed to rename',
    /** Error when save fails */
    saveFailed: 'Failed to save',
  },

  // Error messages (from server error codes)
  errors: {
    /** Error when AI service is overloaded */
    API_OVERLOADED: 'The AI service is currently experiencing high demand. Please try again in a moment.',
    /** Error when rate limited */
    RATE_LIMITED: 'Too many requests. Please wait a moment before trying again.',
    /** Error for unknown/unexpected errors */
    UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
  },
};

/**
 * Customizable text labels for the chat UI.
 */
export type UseAIStrings = typeof defaultStrings;

export const StringsContext = createContext<UseAIStrings>(defaultStrings);

/**
 * Hook to access the current strings.
 * Returns the strings from UseAIProvider, or defaults if not inside a provider.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const strings = useStrings();
 *   return <button>{strings.input.send}</button>;
 * }
 * ```
 */
export function useStrings(): UseAIStrings {
  return useContext(StringsContext);
}
