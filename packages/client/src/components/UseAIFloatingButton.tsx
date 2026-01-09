import React from 'react';
import { useTheme, useStrings } from '../theme';

interface UseAIFloatingButtonProps {
  onClick: () => void;
  connected: boolean;
  hasUnread?: boolean;
}

export function UseAIFloatingButton({
  onClick,
  connected,
  hasUnread = false,
}: UseAIFloatingButtonProps) {
  const strings = useStrings();
  const theme = useTheme();

  return (
    <button
      data-testid="ai-button"
      className="ai-floating-button"
      onClick={onClick}
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        width: '56px',
        height: '56px',
        borderRadius: '50%',
        border: 'none',
        background: connected ? theme.primaryGradient : theme.offlineColor,
        color: 'white',
        fontSize: '20px',
        fontWeight: 'bold',
        cursor: connected ? 'pointer' : 'not-allowed',
        boxShadow: theme.buttonShadow,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'transform 0.2s, box-shadow 0.2s',
        zIndex: 1000,
        fontFamily: theme.fontFamily,
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (connected) {
          e.currentTarget.style.transform = 'scale(1.1)';
          e.currentTarget.style.boxShadow = theme.buttonHoverShadow;
        }
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.boxShadow = theme.buttonShadow;
      }}
      disabled={!connected}
      title={connected ? strings.floatingButton.openAssistant : strings.floatingButton.connectingToAssistant}
    >
      AI
      {hasUnread && (
        <span
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: theme.unreadIndicatorColor,
            border: '2px solid white',
          }}
        />
      )}
    </button>
  );
}
