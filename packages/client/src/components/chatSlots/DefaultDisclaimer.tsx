import React from 'react';
import { useTheme } from '../../theme';
import type { ChatDisclaimerSlotProps } from './types';

/** The notice under the composer reminding the user the AI can be wrong. */
export function DefaultDisclaimer({ text }: ChatDisclaimerSlotProps) {
  const theme = useTheme();

  return (
    <div
      data-testid="chat-input-disclaimer"
      style={{
        padding: '8px 16px 16px',
        fontSize: '12px',
        lineHeight: 1.3,
        color: theme.disclaimerTextColor,
      }}
    >
      {text}
    </div>
  );
}
