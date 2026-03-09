export { useAI } from './useAI';
export { useAIWorkflow } from './useAIWorkflow';
export { UseAIProvider, useAIContext } from './providers/useAIProvider';
export { UseAIClient } from './client';
export { defineTool, executeDefinedTool, convertToolsToDefinitions } from './defineTool';
/** @hidden */
export { z } from 'zod';

// Theme and strings
export {
  defaultStrings,
  defaultTheme,
  useTheme,
  useStrings,
} from './theme';
export type { UseAIStrings, UseAITheme } from './theme';

// Chat UI components
export { UseAIChatPanel } from './components/UseAIChatPanel';
export type {
  Message,
  UseAIChatPanelStrings,
  UseAIChatPanelTheme,
  UseAIChatPanelProps,
} from './components/UseAIChatPanel';
export { UseAIFloatingChatWrapper, CloseButton } from './components/UseAIFloatingChatWrapper';
export { UseAIFloatingButton } from './components/UseAIFloatingButton';
export { UseAIChat } from './components/UseAIChat';
export type { UseAIChatProps } from './components/UseAIChat';

export type { UseAIOptions, UseAIResult } from './useAI';
export type { UseAIWorkflowResult, TriggerWorkflowOptions, WorkflowProgress } from './useAIWorkflow';
export type { UseAIConfig, ToolDefinition, AgentInfo } from './types';
export type {
  UseAIContextValue,
  ChatContextValue,
  AgentContextValue,
  CommandContextValue,
  ToolRegistryContextValue,
  PromptsContextValue,
  FloatingButtonProps,
  ChatPanelProps,
  UseAIProviderProps,
} from './providers/useAIProvider';
export type { SendMessageOptions } from './hooks/useMessageQueue';
export type { DefinedTool, ToolsDefinition, ToolOptions, ToolAnnotations, ToolExecutionContext } from './defineTool';

// Chat persistence
export { LocalStorageChatRepository } from './providers/chatRepository/LocalStorageChatRepository';
export { generateChatId, generateMessageId } from './providers/chatRepository/types';
export type {
  ChatRepository,
  Chat,
  ChatMetadata,
  PersistedMessage,
  PersistedMessageContent,
  PersistedContentPart,
  PersistedTextContent,
  PersistedFileContent,
  CreateChatOptions,
  ListChatsOptions,
} from './providers/chatRepository/types';

// File upload
export { EmbedFileUploadBackend } from './fileUpload/EmbedFileUploadBackend';
export { DEFAULT_MAX_FILE_SIZE } from './fileUpload/types';
export { useFileUpload } from './hooks/useFileUpload';
export { matchesMimeType, findTransformerPattern } from './fileUpload/mimeTypeMatcher';
export { processAttachments, clearTransformationCache } from './fileUpload/processAttachments';
export type {
  FileUploadBackend,
  FileUploadConfig,
  FileAttachment,
  PersistedFileMetadata,
  FileTransformer,
  FileTransformerContext,
  FileTransformerMap,
  FileProcessingStatus,
  FileProcessingState,
} from './fileUpload/types';
export type { ProcessAttachmentsConfig } from './fileUpload/processAttachments';
export type {
  UseFileUploadOptions,
  UseFileUploadReturn,
  DropZoneProps,
} from './hooks/useFileUpload';

// Slash commands
export { LocalStorageCommandRepository } from './commands/LocalStorageCommandRepository';
export { generateCommandId, validateCommandName } from './commands/types';
export { useSlashCommands } from './hooks/useSlashCommands';
export type {
  CommandRepository,
  SavedCommand,
  CreateCommandOptions,
  ListCommandsOptions,
} from './commands/types';
export type {
  UseSlashCommandsOptions,
  UseSlashCommandsReturn,
  InlineSaveProps,
} from './hooks/useSlashCommands';

// Chat management
export { useChatManagement } from './hooks/useChatManagement';
export type {
  UseChatManagementOptions,
  UseChatManagementReturn,
} from './hooks/useChatManagement';

// Agent selection
export { useAgentSelection } from './hooks/useAgentSelection';
export type {
  UseAgentSelectionOptions,
  UseAgentSelectionReturn,
} from './hooks/useAgentSelection';

// Command management
export { useCommandManagement } from './hooks/useCommandManagement';
export type {
  UseCommandManagementOptions,
  UseCommandManagementReturn,
} from './hooks/useCommandManagement';

// Tool system (registry + execution + waiters)
export { useToolSystem } from './hooks/useToolSystem';
export type {
  RegisterToolsOptions,
  PendingToolApproval,
  UseToolSystemOptions,
  UseToolSystemReturn,
} from './hooks/useToolSystem';

// Prompt state
export { usePromptState } from './hooks/usePromptState';
export type {
  UsePromptStateOptions,
  UsePromptStateReturn,
} from './hooks/usePromptState';

// Server events
export { useServerEvents } from './hooks/useServerEvents';
export type {
  UseServerEventsOptions,
  UseServerEventsReturn,
  ExecutingToolDisplay,
} from './hooks/useServerEvents';

// Message queue
export { useMessageQueue } from './hooks/useMessageQueue';
export type {
  UseMessageQueueOptions,
  UseMessageQueueReturn,
} from './hooks/useMessageQueue';

// Feedback
export { useFeedback } from './hooks/useFeedback';
export type {
  UseFeedbackOptions,
  UseFeedbackReturn,
} from './hooks/useFeedback';

// Tool stabilization
export { useStableTools } from './hooks/useStableTools';

// UI utilities
export { useDropdownState } from './hooks/useDropdownState';
export type {
  UseDropdownStateOptions,
  UseDropdownStateReturn,
} from './hooks/useDropdownState';
