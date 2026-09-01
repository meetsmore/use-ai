import React, { useState } from 'react';
import { useStrings, useTheme } from '../../theme';
import { getDisplayTextFromContent, getTextFromContent } from '../../utils/messageContent';
import {
  getReasoningPartsFromStreamingParts,
  getTextFromStreamingParts,
} from '../../utils/streamingParts';
import { MarkdownContent } from '../MarkdownContent';
import { FilePlaceholder } from '../FileChip';
import { Reasoning } from '../Reasoning';
import { FeedbackButton } from './FeedbackButton';
import { fileChipInfo, hasFileContent } from './messageFiles';
import type { PersistedContentPart } from '../../providers/chatRepository/types';
import type { ChatMessageSlotProps } from './types';

/** One chat bubble: the message body plus its reasoning, files and feedback. */
export function DefaultMessage({
  message,
  streaming,
  streamingParts,
  feedbackEnabled,
  onFeedback,
  saveAsCommand,
}: ChatMessageSlotProps) {
  const theme = useTheme();
  const strings = useStrings();
  const [hovered, setHovered] = useState(false);

  // Info notices (e.g. the abort "generation stopped" bubble) are display-only
  // system messages. Render a compact, centered pill: no reasoning dropdown,
  // markdown, feedback, or hover affordances.
  if (message.displayMode === 'info') {
    return (
      <div
        data-testid="chat-message-info"
        className="chat-message chat-message-info"
        style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}
      >
        <div
          style={{
            maxWidth: '80%',
            padding: '6px 12px',
            borderRadius: '12px',
            background: theme.assistantMessageBackground,
            color: theme.secondaryTextColor,
            fontSize: '12px',
            lineHeight: '1.4',
            textAlign: 'center',
            wordWrap: 'break-word',
          }}
        >
          {getDisplayTextFromContent(message.content)}
        </div>
      </div>
    );
  }

  // The provisional bubble is deliberately kept out of `chat-message-assistant`
  // and `chat-message-content`: the E2E suites wait on those test ids to mean
  // "the answer is done", and a bubble that appears with the first token would
  // satisfy that wait mid-stream. Only the attributes change when the answer is
  // persisted, so the elements themselves, and any selection inside them, are
  // untouched.
  const messageTestId = streaming ? 'chat-message-assistant-streaming' : `chat-message-${message.role}`;
  const contentTestId = streaming ? 'chat-message-content-streaming' : 'chat-message-content';
  // One bubble per turn, so the run's ordered parts are flattened the same way
  // mergeAssistantMessagesForDisplay flattens the persisted turn. Both sides
  // must yield the same string for the handoff to leave the element alone.
  const text = streaming ? getTextFromStreamingParts(streamingParts) : getTextFromContent(message.content);
  const streamingReasoningParts = streaming ? getReasoningPartsFromStreamingParts(streamingParts) : [];

  return (
    <div
      data-testid={messageTestId}
      className={`chat-message chat-message-${message.role}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
    <div
      style={{
        position: 'relative',
        maxWidth: '80%',
      }}
    >
      {/* Save as command button - appears on hover for user messages */}
      {hovered && saveAsCommand && !saveAsCommand.isEditing && (
        <button
          data-testid="save-command-button"
          onClick={(e) => {
            e.stopPropagation();
            saveAsCommand.start();
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
        data-testid={contentTestId}
        className={`chat-message-content${message.role === 'assistant' ? ' markdown-content' : ''}`}
        style={{
          padding: '10px 14px',
          borderRadius: saveAsCommand?.isEditing
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
          {message.content.flatMap((part: PersistedContentPart, idx: number) => {
            const info = fileChipInfo(part);
            return info
              ? [<FilePlaceholder key={idx} name={info.name} size={info.size} />]
              : [];
          })}
        </div>
      )}
      {message.role === 'assistant' ? (
        <>
          {streaming && streamingReasoningParts.length > 0 && (
            <Reasoning
              reasoningParts={streamingReasoningParts}
              isStreaming={true}
              theme={theme}
              strings={strings}
            />
          )}
          {!streaming && message.reasoningParts && message.reasoningParts.length > 0 && (
            <Reasoning
              reasoningParts={message.reasoningParts}
              theme={theme}
              strings={strings}
            />
          )}
          {streaming && !text ? (
            <span className="dots" style={{ opacity: 0.6 }}>...</span>
          ) : (
            <MarkdownContent content={text} />
          )}
        </>
      ) : (
        // User/tool bubbles: display-only text so transformed_file
        // (e.g. OCR body) isn't dumped into the chat bubble.
        getDisplayTextFromContent(message.content)
      )}
      </div>
      {/* Inline save command UI - glued to chat bubble */}
      {saveAsCommand?.editor}
    </div>
    {/* Feedback buttons - only for assistant messages with traceId */}
    {message.role === 'assistant' && !streaming && message.traceId && feedbackEnabled && onFeedback && (
      <div
        data-testid="feedback-buttons"
        style={{
          display: 'flex',
          gap: '4px',
          marginTop: '4px',
          padding: '0 4px',
        }}
      >
        <FeedbackButton
          type="upvote"
          isSelected={message.feedback === 'upvote'}
          onClick={() => {
            const newFeedback = message.feedback === 'upvote' ? null : 'upvote';
            onFeedback(message.id, message.traceId!, newFeedback);
          }}
          selectedColor={theme.primaryColor}
          unselectedColor={theme.secondaryTextColor}
        />
        <FeedbackButton
          type="downvote"
          isSelected={message.feedback === 'downvote'}
          onClick={() => {
            const newFeedback = message.feedback === 'downvote' ? null : 'downvote';
            onFeedback(message.id, message.traceId!, newFeedback);
          }}
          selectedColor={theme.errorTextColor}
          unselectedColor={theme.secondaryTextColor}
        />
      </div>
    )}
    {!streaming && (
      <div
        data-testid="message-timestamp"
        style={{
          fontSize: '11px',
          color: theme.secondaryTextColor,
          marginTop: '4px',
          padding: '0 4px',
        }}
      >
        {message.createdAt.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        })}
      </div>
    )}
    </div>
  );
}
