import React from 'react';
import { useStrings, useTheme } from '../../theme';
import type { ChatEmptyStateSlotProps } from './types';

/** The greeting and suggestion buttons shown before a chat has any messages. */
export function DefaultEmptyState({
  suggestions,
  connected,
  loading,
  onSelectSuggestion,
}: ChatEmptyStateSlotProps) {
  const theme = useTheme();
  const strings = useStrings();
  const interactive = connected && !loading;

  return (
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

      {suggestions.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '8px',
            width: '100%',
            maxWidth: '320px',
          }}
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              data-testid="chat-suggestion-button"
              onClick={() => onSelectSuggestion(suggestion)}
              disabled={!interactive}
              style={{
                padding: '10px 14px',
                background: theme.backgroundColor,
                border: `1px solid ${theme.borderColor}`,
                borderRadius: '8px',
                fontSize: '13px',
                color: theme.textColor,
                cursor: interactive ? 'pointer' : 'not-allowed',
                textAlign: 'left',
                transition: 'all 0.2s',
                lineHeight: '1.4',
                opacity: interactive ? 1 : 0.5,
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                if (interactive) {
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
  );
}
