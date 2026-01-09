import React from 'react';
import { useTheme } from '../theme';

/**
 * Props for the floating chat wrapper.
 */
interface UseAIFloatingChatWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Wrapper that adds floating chrome (backdrop, positioning, animations).
 * Wrap UseAIChatPanel with this for a floating chat experience.
 */
export function UseAIFloatingChatWrapper({
  isOpen,
  onClose,
  children,
}: UseAIFloatingChatWrapperProps) {
  const theme = useTheme();

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: theme.backdropColor,
          zIndex: 999,
          animation: 'fadeIn 0.2s',
        }}
        onClick={onClose}
      />

      {/* Floating panel */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '380px',
          height: '600px',
          maxHeight: 'calc(100vh - 48px)',
          borderRadius: '16px',
          boxShadow: theme.panelShadow,
          zIndex: 1001,
          animation: 'slideIn 0.3s ease-out',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideIn {
          from {
            transform: translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
}

interface CloseButtonProps {
  onClick: () => void;
}

/**
 * Close button component for the floating chat header.
 */
export function CloseButton({ onClick }: CloseButtonProps) {
  const theme = useTheme();

  return (
    <button
      data-testid="chat-close-button"
      className="chat-close-button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        borderRadius: '6px',
        padding: '6px 8px',
        cursor: 'pointer',
        color: theme.secondaryTextColor,
        fontSize: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s',
        lineHeight: 1,
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.background = theme.hoverBackground;
        e.currentTarget.style.color = theme.textColor;
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = theme.secondaryTextColor;
      }}
    >
      ×
    </button>
  );
}
