import React, { useEffect, useRef } from 'react';
import { FileChip } from '../FileChip';
import { useStrings, useTheme } from '../../theme';
import { shouldSubmitOnEnter } from '../../utils/keyboard';
import type { ChatComposerSlotProps } from './types';

/** Tallest the textarea grows to before it starts scrolling. */
const MAX_TEXTAREA_HEIGHT = 160;

/** The message input: attachments, slash-command autocomplete, send/stop. */
export function DefaultComposer({
  input,
  connected,
  loading,
  placeholder,
  canSend,
  canAbort,
  attachments,
  fileUploadEnabled,
  fileError,
  pendingApprovals,
  onInputChange,
  onSend,
  onAbort,
  onOpenFilePicker,
  onRemoveAttachment,
  submitMode,
  attachmentProcessing,
  disclaimerVisible,
  slashCommands,
}: ChatComposerSlotProps) {
  const theme = useTheme();
  const strings = useStrings();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the textarea to its content, up to MAX_TEXTAREA_HEIGHT.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset to single row to measure actual content height
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [input]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onInputChange(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash command navigation claims the key first.
    if (slashCommands.onKeyDown(e)) return;

    if (shouldSubmitOnEnter(e, submitMode)) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div
      style={{
        padding: disclaimerVisible ? '16px 16px 0' : '16px',
        borderTop: `1px solid ${theme.borderColor}`,
        ...(pendingApprovals.length > 0 ? { display: 'none' } : {}),
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
            onRemove={() => onRemoveAttachment(attachment.id)}
            disabled={loading}
            processingState={attachmentProcessing.get(attachment.id)}
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
        {slashCommands.list}

        {/* Textarea area */}
        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          className="chat-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={!connected || loading || pendingApprovals.length > 0}
          rows={1}
          style={{
            width: '100%',
            padding: '10px 14px 6px',
            border: 'none',
            fontSize: '14px',
            lineHeight: '1.4',
            resize: 'none',
            maxHeight: `${MAX_TEXTAREA_HEIGHT}px`,
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
                onClick={onOpenFilePicker}
                disabled={!connected || loading || pendingApprovals.length > 0}
                style={{
                  padding: '4px',
                  background: 'transparent',
                  border: `1px solid ${theme.borderColor}`,
                  borderRadius: '50%',
                  cursor: connected && !loading && pendingApprovals.length === 0 ? 'pointer' : 'not-allowed',
                  color: theme.secondaryTextColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  transition: 'all 0.15s',
                  opacity: connected && !loading && pendingApprovals.length === 0 ? 1 : 0.5,
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                  if (connected && !loading && pendingApprovals.length === 0) {
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

          {/* Right side - send / stop button.
              While loading and a stop handler is wired up, swap in a stop
              button so the user can interrupt streaming. Disabled when a
              tool is currently executing — that branch can't be safely
              cancelled in Phase 1 because the tool's side effects have
              already run on the client. */}
          {(() => {
            if (loading && onAbort) {
              return (
                <button
                  data-testid="chat-stop-button"
                  className="chat-stop-button"
                  onClick={onAbort}
                  disabled={!canAbort}
                  title={canAbort ? 'Stop generating' : 'Cannot stop while a tool is running'}
                  aria-label="Stop generating"
                  style={{
                    padding: '6px',
                    background: canAbort ? theme.stopButtonBackground : theme.buttonDisabledBackground,
                    color: theme.secondaryTextColor,
                    border: 'none',
                    borderRadius: '50%',
                    cursor: canAbort ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    transition: 'all 0.2s',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              );
            }
            return (
              <button
                data-testid="chat-send-button"
                className="chat-send-button"
                onClick={onSend}
                disabled={!canSend}
                style={{
                  padding: '6px',
                  background: canSend ? theme.primaryGradient : theme.buttonDisabledBackground,
                  color: canSend ? 'white' : theme.secondaryTextColor,
                  border: 'none',
                  borderRadius: '50%',
                  cursor: canSend ? 'pointer' : 'not-allowed',
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
            );
          })()}
        </div>
      </div>

    </div>
  );
}
