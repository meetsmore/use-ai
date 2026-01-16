import React, { useState, useRef, useEffect } from 'react';
import type { Chat, PersistedMessageContent, PersistedContentPart } from '../providers/chatRepository/types';
import type { AgentInfo } from '../types';
import type { FileAttachment, FileUploadConfig } from '../fileUpload/types';
import { MarkdownContent } from './MarkdownContent';
import { FileChip, FilePlaceholder } from './FileChip';
import type { SavedCommand } from '../commands/types';
import { useSlashCommands } from '../hooks/useSlashCommands';
import { useFileUpload } from '../hooks/useFileUpload';
import { useDropdownState } from '../hooks/useDropdownState';
import { useTheme, useStrings } from '../theme';
import type { UseAIStrings, UseAITheme } from '../theme';

// Re-export types for backwards compatibility
export type UseAIChatPanelStrings = UseAIStrings;
export type UseAIChatPanelTheme = UseAITheme;

/**
 * Display mode for chat messages.
 */
type MessageDisplayMode = 'default' | 'error';

/**
 * Represents a single message in the AI conversation.
 */
interface Message {
  /** Unique identifier for the message */
  id: string;
  /** The role of the message sender */
  role: 'user' | 'assistant';
  /** The message content - string or multimodal content */
  content: PersistedMessageContent;
  /** When the message was created */
  timestamp: Date;
  /** Display mode for styling the message bubble */
  displayMode?: MessageDisplayMode;
}

/**
 * Helper to extract text content from message content.
 */
function getTextContent(content: PersistedMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}

/**
 * Helper to check if content has file attachments.
 */
function hasFileContent(content: PersistedMessageContent): content is PersistedContentPart[] {
  return Array.isArray(content) && content.some(part => part.type === 'file');
}

/**
 * Props for the chat panel component.
 */
export interface UseAIChatPanelProps {
  onSendMessage: (message: string, attachments?: FileAttachment[]) => void;
  messages: Message[];
  loading: boolean;
  connected: boolean;
  /** Currently streaming text from assistant (real-time updates) */
  streamingText?: string;
  currentChatId?: string | null;
  onNewChat?: () => Promise<string | void>;
  onLoadChat?: (chatId: string) => Promise<void>;
  onDeleteChat?: (chatId: string) => Promise<void>;
  onListChats?: () => Promise<Array<Omit<Chat, 'messages'>>>;
  suggestions?: string[];
  availableAgents?: AgentInfo[];
  defaultAgent?: string | null;
  selectedAgent?: string | null;
  onAgentChange?: (agentId: string | null) => void;
  fileUploadConfig?: FileUploadConfig;
  commands?: SavedCommand[];
  onSaveCommand?: (name: string, text: string) => Promise<string>;
  onRenameCommand?: (id: string, newName: string) => Promise<void>;
  onDeleteCommand?: (id: string) => Promise<void>;
  /** Optional close button to render in header (for floating mode) */
  closeButton?: React.ReactNode;
}

/**
 * Chat panel content - fills its container.
 * Use directly for embedded mode, or wrap with UseAIFloatingChatWrapper for floating mode.
 */
export function UseAIChatPanel({
  onSendMessage,
  messages,
  loading,
  connected,
  streamingText = '',
  currentChatId,
  onNewChat,
  onLoadChat,
  onDeleteChat,
  onListChats,
  suggestions,
  availableAgents,
  defaultAgent,
  selectedAgent,
  onAgentChange,
  fileUploadConfig,
  commands = [],
  onSaveCommand,
  onRenameCommand,
  onDeleteCommand,
  closeButton,
}: UseAIChatPanelProps) {
  const strings = useStrings();
  const theme = useTheme();

  const [input, setInput] = useState('');
  const chatHistoryDropdown = useDropdownState();
  const agentDropdown = useDropdownState();
  const [chatHistory, setChatHistory] = useState<Array<Omit<Chat, 'messages'>>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [displayedSuggestions, setDisplayedSuggestions] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Message hover state for save button
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);

  // File upload hook
  const {
    attachments,
    fileError,
    enabled: fileUploadEnabled,
    acceptedTypes,
    fileInputRef,
    removeAttachment,
    clearAttachments,
    openFilePicker,
    handleFileInputChange,
    getDropZoneProps,
    DropZoneOverlay,
  } = useFileUpload({
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

  const maxTextareaHeight = 160;

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset to single row to measure actual content height
    textarea.style.height = 'auto';

    // Calculate new height based on scrollHeight (clamped to max)
    const newHeight = Math.min(textarea.scrollHeight, maxTextareaHeight);
    textarea.style.height = `${newHeight}px`;
  }, [input]);

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

  // Handle input change with slash command detection
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    slashCommands.handleInputChange(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Let slash commands hook handle keyboard navigation
    if (slashCommands.handleKeyDown(e)) {
      return;
    }

    // Normal send on Enter (except during IME composition, e.g: Japanese input)
    // On Safari, `isComposing` becomes false when pressing Enter to confirm IME input.
    // We use `e.keyCode` to handle this Safari-specific behavior, even though it is deprecated.
    // Reference: https://zenn.dev/spacemarket/articles/149aa284ef7b08
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !(e.keyCode === 229)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = async () => {
    if (onNewChat) {
      await onNewChat();
    }
  };

  const handleDeleteChat = async () => {
    if (onDeleteChat && currentChatId && confirm(strings.header.deleteConfirm)) {
      await onDeleteChat(currentChatId);
      if (onNewChat) {
        await onNewChat();
      }
    }
  };

  const handleLoadChat = async (chatId: string) => {
    if (onLoadChat) {
      await onLoadChat(chatId);
      chatHistoryDropdown.close();
    }
  };

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
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${theme.borderColor}`,
          background: theme.backgroundColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        {/* Left side: Chat dropdown */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {onListChats ? (
            <button
              data-testid="chat-history-dropdown-button"
              onClick={async () => {
                const chats = await onListChats();
                setChatHistory(chats);
                chatHistoryDropdown.toggle();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '6px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: theme.textColor,
                borderRadius: '6px',
                transition: 'background 0.2s',
                width: '100%',
                textAlign: 'left',
                overflow: 'hidden',
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.background = theme.hoverBackground;
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}>
                {/* Get current chat title */}
                {(() => {
                  if (messages.length > 0) {
                    const firstUserMsg = messages.find((m: Message) => m.role === 'user');
                    if (firstUserMsg) {
                      const textContent = getTextContent(firstUserMsg.content);
                      const maxLength = 30;
                      return textContent.length > maxLength
                        ? textContent.substring(0, maxLength) + '...'
                        : textContent || strings.header.newChat;
                    }
                  }
                  return strings.header.newChat;
                })()}
              </span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          ) : (
            <div style={{ fontSize: '14px', fontWeight: '600', color: theme.textColor, padding: '6px 8px' }}>
              {strings.header.aiAssistant}
            </div>
          )}
        </div>

        {/* Right side: Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* Model selector */}
          {availableAgents && availableAgents.length > 1 && onAgentChange && (
            <div style={{ position: 'relative' }}>
              <button
                data-testid="agent-selector"
                onClick={agentDropdown.toggle}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '6px 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: theme.secondaryTextColor,
                  borderRadius: '6px',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                  e.currentTarget.style.background = theme.hoverBackground;
                  e.currentTarget.style.color = theme.textColor;
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = theme.secondaryTextColor;
                }}
                title="Select AI model"
              >
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '120px',
                }}>
                  {(() => {
                    const agent = availableAgents.find((a: AgentInfo) => a.id === (selectedAgent ?? defaultAgent));
                    return agent?.name || 'AI';
                  })()}
                </span>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Agent Selector Dropdown */}
              {agentDropdown.isOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginTop: '4px',
                    minWidth: '180px',
                    maxWidth: '280px',
                    background: theme.backgroundColor,
                    borderRadius: '8px',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
                    zIndex: 1003,
                    overflow: 'hidden',
                    padding: '4px',
                  }}
                >
                  {availableAgents.map((agent: AgentInfo) => {
                    const isSelected = agent.id === (selectedAgent ?? defaultAgent);
                    return (
                      <div
                        key={agent.id}
                        data-testid="agent-option"
                        onClick={() => {
                          onAgentChange(agent.id === defaultAgent ? null : agent.id);
                          agentDropdown.close();
                        }}
                        style={{
                          padding: '8px 12px',
                          background: isSelected ? theme.activeBackground : 'transparent',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                        }}
                        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                          if (!isSelected) {
                            e.currentTarget.style.background = theme.hoverBackground;
                          }
                        }}
                        onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                          if (!isSelected) {
                            e.currentTarget.style.background = 'transparent';
                          }
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: '13px',
                            fontWeight: isSelected ? '600' : '500',
                            color: isSelected ? theme.primaryColor : theme.textColor,
                          }}>
                            {agent.name}
                          </div>
                          {agent.annotation && (
                            <div style={{
                              fontSize: '11px',
                              color: theme.secondaryTextColor,
                              marginTop: '2px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {agent.annotation}
                            </div>
                          )}
                        </div>
                        {isSelected && (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                            <path d="M2 7L5.5 10.5L12 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* New Chat button */}
          {onNewChat && (
            <button
              data-testid="new-chat-button"
              onClick={handleNewChat}
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 8px',
                color: theme.secondaryTextColor,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.background = theme.hoverBackground;
                e.currentTarget.style.color = theme.textColor;
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = theme.secondaryTextColor;
              }}
              title={strings.header.newChat}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}

          {/* Delete button */}
          {onDeleteChat && messages.length > 0 && (
            <button
              data-testid="delete-chat-button"
              onClick={handleDeleteChat}
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 8px',
                color: theme.secondaryTextColor,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.background = theme.hoverBackground;
                e.currentTarget.style.color = theme.textColor;
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = theme.secondaryTextColor;
              }}
              title={strings.header.deleteChat}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4H14M6.5 7V11M9.5 7V11M3 4L4 13C4 13.5304 4.21071 14.0391 4.58579 14.4142C4.96086 14.7893 5.46957 15 6 15H10C10.5304 15 11.0391 14.7893 11.4142 14.4142C11.7893 14.0391 12 13.5304 12 13L13 4M5.5 4V2.5C5.5 2.23478 5.60536 1.98043 5.79289 1.79289C5.98043 1.60536 6.23478 1.5 6.5 1.5H9.5C9.76522 1.5 10.0196 1.60536 10.2071 1.79289C10.3946 1.98043 10.5 2.23478 10.5 2.5V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}

          {/* Optional close button (passed in for floating mode) */}
          {closeButton}
        </div>
      </div>

      {/* Chat History Dropdown */}
      {chatHistoryDropdown.isOpen && onListChats && (
        <div
          style={{
            position: 'absolute',
            top: '60px',
            left: '16px',
            width: '320px',
            maxHeight: '400px',
            background: theme.backgroundColor,
            borderRadius: '8px',
            boxShadow: theme.panelShadow,
            zIndex: 1003,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Chat List */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px',
            }}
          >
            {chatHistory.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  color: theme.secondaryTextColor,
                  padding: '32px 16px',
                  fontSize: '13px',
                }}
              >
                <p style={{ margin: 0 }}>{strings.chatHistory.noChatHistory}</p>
              </div>
            ) : (
              chatHistory.map((chat) => (
                <div
                  key={chat.id}
                  data-testid="chat-history-item"
                  onClick={() => handleLoadChat(chat.id)}
                  style={{
                    padding: '10px 12px',
                    marginBottom: '4px',
                    background: currentChatId === chat.id ? theme.activeBackground : 'transparent',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (currentChatId !== chat.id) {
                      e.currentTarget.style.background = theme.hoverBackground;
                    }
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (currentChatId !== chat.id) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: '500', color: theme.textColor, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chat.title || strings.header.newChat}
                  </div>
                  <div style={{ fontSize: '11px', color: theme.secondaryTextColor }}>
                    {new Date(chat.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    {currentChatId === chat.id && (
                      <span style={{
                        marginLeft: '8px',
                        color: theme.primaryColor,
                        fontWeight: '600',
                      }}>
                        • {strings.chatHistory.active}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Backdrops to close dropdowns */}
      {chatHistoryDropdown.Backdrop}
      {agentDropdown.Backdrop}

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
        {messages.length === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '40px 20px',
              gap: '20px',
            }}
          >
            <div style={{ textAlign: 'center', color: theme.secondaryTextColor, fontSize: '14px' }}>
              <p style={{ margin: 0, fontSize: '32px', marginBottom: '12px' }}>💬</p>
              <p style={{ margin: 0 }}>{strings.emptyChat.startConversation}</p>
              <p style={{ margin: '8px 0 0', fontSize: '12px' }}>
                {strings.emptyChat.askMeToHelp}
              </p>
            </div>

            {/* Suggestions */}
            {displayedSuggestions.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '8px',
                  width: '100%',
                  maxWidth: '320px',
                }}
              >
                {displayedSuggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    data-testid="chat-suggestion-button"
                    onClick={() => {
                      if (connected && !loading) {
                        onSendMessage(suggestion);
                      }
                    }}
                    disabled={!connected || loading}
                    style={{
                      padding: '10px 14px',
                      background: theme.backgroundColor,
                      border: `1px solid ${theme.borderColor}`,
                      borderRadius: '8px',
                      fontSize: '13px',
                      color: theme.textColor,
                      cursor: connected && !loading ? 'pointer' : 'not-allowed',
                      textAlign: 'left',
                      transition: 'all 0.2s',
                      lineHeight: '1.4',
                      opacity: connected && !loading ? 1 : 0.5,
                    }}
                    onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                      if (connected && !loading) {
                        e.currentTarget.style.background = theme.hoverBackground;
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.08)';
                      }
                    }}
                    onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.currentTarget.style.background = theme.backgroundColor;
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((message: Message) => (
          <div
            key={message.id}
            data-testid={`chat-message-${message.role}`}
            className={`chat-message chat-message-${message.role}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
            }}
            onMouseEnter={() => message.role === 'user' && setHoveredMessageId(message.id)}
            onMouseLeave={() => setHoveredMessageId(null)}
          >
            <div
              style={{
                position: 'relative',
                maxWidth: '80%',
              }}
            >
              {/* Save as command button - appears on hover for user messages */}
              {message.role === 'user' && hoveredMessageId === message.id && onSaveCommand && !slashCommands.isSavingCommand(message.id) && (
                <button
                  data-testid="save-command-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const messageText = getTextContent(message.content);
                    slashCommands.startSavingCommand(message.id, messageText);
                  }}
                  title="Save as slash command"
                  style={{
                    position: 'absolute',
                    top: '-8px',
                    right: '-8px',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    border: 'none',
                    background: theme.backgroundColor,
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: theme.primaryColor,
                    transition: 'all 0.15s',
                    zIndex: 10,
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.currentTarget.style.transform = 'scale(1.1)';
                    e.currentTarget.style.boxShadow = '0 3px 8px rgba(0, 0, 0, 0.2)';
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)';
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                </button>
              )}
              <div
                data-testid="chat-message-content"
                className={`chat-message-content${message.role === 'assistant' ? ' markdown-content' : ''}`}
                style={{
                  padding: '10px 14px',
                  borderRadius: slashCommands.isSavingCommand(message.id)
                    ? '12px 12px 0 0'
                    : '12px',
                  background: message.displayMode === 'error'
                    ? theme.errorBackground
                    : message.role === 'user'
                    ? theme.primaryGradient
                    : theme.assistantMessageBackground,
                  color: message.displayMode === 'error'
                    ? theme.errorTextColor
                    : message.role === 'user' ? 'white' : theme.textColor,
                  fontSize: '14px',
                  lineHeight: '1.5',
                  wordWrap: 'break-word',
                }}
              >
              {/* Render file placeholders for user messages with files */}
              {message.role === 'user' && hasFileContent(message.content) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                  {message.content
                    .filter((part: PersistedContentPart): part is { type: 'file'; file: { name: string; size: number; mimeType: string } } => part.type === 'file')
                    .map((part: { type: 'file'; file: { name: string; size: number; mimeType: string } }, idx: number) => (
                      <FilePlaceholder
                        key={idx}
                        name={part.file.name}
                        size={part.file.size}
                      />
                    ))}
                </div>
              )}
              {message.role === 'assistant' ? (
                <MarkdownContent content={getTextContent(message.content)} />
              ) : (
                getTextContent(message.content)
              )}
              </div>
              {/* Inline save command UI - glued to chat bubble */}
              {slashCommands.renderInlineSaveUI({
                messageId: message.id,
                messageText: getTextContent(message.content),
              })}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: theme.secondaryTextColor,
                marginTop: '4px',
                padding: '0 4px',
              }}
            >
              {message.timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </div>
        ))}

        {loading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
            }}
          >
            <div
              className="markdown-content"
              style={{
                padding: '10px 14px',
                borderRadius: '12px',
                background: theme.assistantMessageBackground,
                fontSize: '14px',
                lineHeight: '1.5',
                color: theme.textColor,
                maxWidth: '80%',
              }}
            >
              {streamingText ? (
                <MarkdownContent content={streamingText} />
              ) : (
                <>
                  <span style={{ opacity: 0.6 }}>{strings.input.thinking}</span>
                  <span className="dots" style={{ marginLeft: '4px' }}>...</span>
                </>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: '16px',
          borderTop: `1px solid ${theme.borderColor}`,
        }}
      >
        {/* File error message */}
        {fileError && (
          <div
            data-testid="file-error"
            style={{
              marginBottom: '8px',
              padding: '8px 12px',
              background: theme.errorBackground,
              color: theme.errorTextColor,
              borderRadius: '6px',
              fontSize: '13px',
            }}
          >
            {fileError}
          </div>
        )}

        {/* File chips */}
        {attachments.length > 0 && (
          <div
            data-testid="file-attachments"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            {attachments.map((attachment) => (
              <FileChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
                disabled={loading}
              />
            ))}
          </div>
        )}

        {/* Input container - single border around everything */}
        <div
          style={{
            border: `1px solid ${theme.borderColor}`,
            borderRadius: '12px',
            background: theme.backgroundColor,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Command Autocomplete */}
          {slashCommands.AutocompleteComponent}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
            accept={acceptedTypes?.join(',')}
          />

          {/* Textarea area */}
          <textarea
            ref={textareaRef}
            data-testid="chat-input"
            className="chat-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={connected ? strings.input.placeholder : strings.input.connectingPlaceholder}
            disabled={!connected || loading}
            rows={1}
            style={{
              width: '100%',
              padding: '10px 14px 6px',
              border: 'none',
              fontSize: '14px',
              lineHeight: '1.4',
              resize: 'none',
              maxHeight: `${maxTextareaHeight}px`,
              fontFamily: 'inherit',
              outline: 'none',
              background: 'transparent',
              overflowY: 'auto',
              boxSizing: 'border-box',
            }}
          />

          {/* Bottom toolbar - fixed */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 8px',
            }}
          >
            {/* Left side - file picker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {fileUploadEnabled && (
                <button
                  data-testid="file-picker-button"
                  onClick={openFilePicker}
                  disabled={!connected || loading}
                  style={{
                    padding: '4px',
                    background: 'transparent',
                    border: `1px solid ${theme.borderColor}`,
                    borderRadius: '50%',
                    cursor: connected && !loading ? 'pointer' : 'not-allowed',
                    color: theme.secondaryTextColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '28px',
                    height: '28px',
                    transition: 'all 0.15s',
                    opacity: connected && !loading ? 1 : 0.5,
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                    if (connected && !loading) {
                      e.currentTarget.style.color = theme.primaryColor;
                      e.currentTarget.style.borderColor = theme.primaryColor;
                    }
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.currentTarget.style.color = theme.secondaryTextColor;
                    e.currentTarget.style.borderColor = theme.borderColor;
                  }}
                  title={strings.fileUpload.attachFiles}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Right side - send button */}
            <button
              data-testid="chat-send-button"
              className="chat-send-button"
              onClick={handleSend}
              disabled={!connected || loading || (!input.trim() && attachments.length === 0)}
              style={{
                padding: '6px',
                background: connected && !loading && (input.trim() || attachments.length > 0)
                  ? theme.primaryGradient
                  : theme.buttonDisabledBackground,
                color: connected && !loading && (input.trim() || attachments.length > 0) ? 'white' : theme.secondaryTextColor,
                border: 'none',
                borderRadius: '50%',
                cursor: connected && !loading && (input.trim() || attachments.length > 0) ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                transition: 'all 0.2s',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

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
